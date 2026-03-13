import * as vscode from "vscode";
import {
  generateApi,
  GenerateResult,
  PromptTemplate,
} from "../api/generate.api";
import { apisApi } from "../api/apis.api";
import { extractApiError } from "../utils/errors";
import { resolveChanges, showPreview } from "../utils/previewPanel";

const FRAMEWORKS = [
  { label: "React", value: "React 18+ with TypeScript" },
  { label: "Vue.js", value: "Vue 3 with Composition API and TypeScript" },
  { label: "Angular", value: "Angular 17+ with TypeScript" },
  { label: "Svelte", value: "SvelteKit with TypeScript" },
  { label: "Next.js", value: "Next.js 14+ App Router with TypeScript" },
];

const DESIGN_SYSTEMS = [
  { label: "MUI (Material UI)", value: "Material UI (MUI) v5" },
  { label: "Ant Design (AntD)", value: "Ant Design (AntD) v5" },
  { label: "shadcn/ui", value: "shadcn/ui with Tailwind CSS" },
  { label: "Tailwind CSS", value: "Tailwind CSS v3 (utility-first)" },
  { label: "Chakra UI", value: "Chakra UI v2" },
  { label: "None", value: "" },
];

export async function generateCmd() {
  // Prompt source
  const promptSource = await vscode.window.showQuickPick(
    [
      {
        label: "Custom Prompt",
        description: "Enter your own prompt",
        value: "custom",
      },
      {
        label: "Pre-built Template",
        description: "Fetch prompt templates from backend",
        value: "template",
      },
    ],
    {
      title: "Quick Generate \u2014 Prompt Source",
      placeHolder: "How do you want to provide the prompt?",
    },
  );
  if (!promptSource) {
    return;
  }

  let prompt: string | undefined;

  if (promptSource.value === "custom") {
    const editor = vscode.window.activeTextEditor;
    const selected = editor?.document.getText(editor.selection);
    prompt = await vscode.window.showInputBox({
      title: "Quick Generate \u2014 Custom Prompt",
      prompt: "Describe the UI you want to generate",
      placeHolder:
        "e.g. Create a user management dashboard with table, search, and CRUD",
      value: selected || "",
      ignoreFocusOut: true,
    });
  } else {
    // Fetch templates from backend
    let templates: PromptTemplate[] = [];
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Quick Generate \u2014 Loading templates...",
      },
      async () => {
        try {
          templates = await generateApi.getTemplates();
        } catch (e: unknown) {
          vscode.window.showErrorMessage(
            `Failed to fetch templates: ${extractApiError(e)}`,
          );
        }
      },
    );
    if (templates.length === 0) {
      vscode.window.showWarningMessage(
        "No templates available. Please use a custom prompt.",
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(
      templates.map((t) => ({
        label: t.label,
        description: t.description,
        detail:
          t.prompt.length > 120 ? t.prompt.slice(0, 120) + "\u2026" : t.prompt,
        value: t.prompt,
      })),
      {
        title: "Quick Generate \u2014 Select Template",
        placeHolder: "Choose a pre-built prompt template",
        matchOnDetail: true,
      },
    );
    if (!picked) {
      return;
    }

    // Allow user to optionally edit the template prompt
    prompt = await vscode.window.showInputBox({
      title: "Quick Generate \u2014 Edit Template (optional)",
      prompt:
        "You can customize the template prompt or press Enter to use as-is",
      value: picked.value,
      ignoreFocusOut: true,
    });
  }

  if (!prompt?.trim()) {
    return;
  }

  // Framework selection
  const framework = await vscode.window.showQuickPick(
    FRAMEWORKS.map((f) => ({ label: f.label, value: f.value })),
    {
      title: "Quick Generate \u2014 Framework",
      placeHolder: "Select the frontend framework",
    },
  );
  if (!framework) {
    return;
  }

  // Design System selection
  const designSystem = await vscode.window.showQuickPick(
    DESIGN_SYSTEMS.map((d) => ({ label: d.label, value: d.value })),
    {
      title: "Quick Generate \u2014 Design System",
      placeHolder: "Select the design system or CSS strategy",
    },
  );
  if (!designSystem) {
    return;
  }

  // AI Provider + Model
  const cfg = vscode.workspace.getConfiguration("uigenai");
  const provider = await vscode.window.showQuickPick(
    [
      { label: "Gemini", description: "Google AI", value: "gemini" },
      { label: "OpenAI", description: "OpenAI API", value: "openai" },
    ],
    {
      title: "Quick Generate \u2014 AI Provider",
      placeHolder: "Choose the AI provider",
    },
  );
  if (!provider) {
    return;
  }

  const model = await vscode.window.showInputBox({
    title: "Quick Generate \u2014 Model",
    prompt: `Enter the model name for ${provider.label}`,
    placeHolder: "e.g. gemini-2.0-flash or gpt-4o",
    value:
      provider.value === "gemini"
        ? cfg.get("defaultModel", "gemini-2.0-flash")
        : "gpt-4o",
  });
  if (!model) {
    return;
  }

  // Optional: link to an API
  let apiId: string | undefined;
  const linkApi = await vscode.window.showQuickPick(
    [
      { label: "No, just generate", value: "no" },
      { label: "Yes, save to an API", value: "yes" },
    ],
    {
      title: "Quick Generate \u2014 Link to API?",
      placeHolder: "Save generated code to an existing API record",
    },
  );
  if (linkApi?.value === "yes") {
    try {
      const apis = await apisApi.list();
      if (apis.length > 0) {
        const pick = await vscode.window.showQuickPick(
          apis.map((a) => ({
            label: a.name,
            description: a.base_url || "",
            value: a.id,
          })),
          {
            title: "Quick Generate \u2014 Select API",
            placeHolder: "Choose an API to link",
          },
        );
        apiId = pick?.value;
      } else {
        vscode.window.showWarningMessage(
          "No APIs found. Generating without saving.",
        );
      }
    } catch {
      /* skip if not logged in */
    }
  }

  // Build final prompt with framework + design system
  const extras: string[] = [];
  extras.push(`**Framework**: ${framework.value}`);
  if (designSystem.value) {
    extras.push(`**Design System / Styling**: ${designSystem.value}`);
  }
  const finalPrompt = `${prompt.trim()}\n\n## Tech Preferences\n${extras.join("\n")}`;

  let result: GenerateResult | undefined;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Quick Generate \u2014 Generating code...",
    },
    async () => {
      try {
        result = await generateApi.generate({
          prompt: finalPrompt,
          provider: provider.value,
          model,
          apiId,
        });
      } catch (e: unknown) {
        vscode.window.showErrorMessage(
          `Generation failed: ${extractApiError(e)}`,
        );
      }
    },
  );

  if (!result) {
    return;
  }

  const hasChanges = resolveChanges(result).length > 0;
  if (!hasChanges) {
    vscode.window.showWarningMessage(
      "AI returned no code. Try a more specific prompt.",
    );
    return;
  }

  const previewLabel = `${prompt.trim()}  [${framework.label} \u00B7 ${designSystem.label}]`;
  showPreview(result, previewLabel);
}
