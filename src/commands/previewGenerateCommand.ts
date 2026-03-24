/**
 * Preview Generate Command - Simplified Input Flow with Skill Support
 *
 * Only requires API spec, actions and design are optional text prompts.
 * Supports skill enhancement from ui-ux-pro-max-skill.
 * Generates a preview first, then user can iterate or generate full code.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import { generateApi, GenerateResult } from "../api/generate.api";
import { extractApiError } from "../utils/errors";
import { pickProviderAndModel } from "../utils/uxHelpers";
import { showPreviewWebview, PreviewState } from "../utils/previewWebview";
import {
  loadSkill,
  pickSkillOption,
  pickDesignTemplate,
  pickActionsTemplate,
  enhanceActionsPrompt,
  enhanceDesignPrompt,
  UI_UX_PRO_MAX_SKILL,
  Skill,
} from "../utils/skillLoader";

const FLOW_NAME = "Preview Generate";

export async function previewGenerateCmd(
  context: vscode.ExtensionContext,
): Promise<void> {
  // Step 1: Pick OpenAPI file
  const fileUris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      "OpenAPI / Swagger": ["json", "yaml", "yml"],
    },
    title: `${FLOW_NAME} — Step 1 of 5: Select OpenAPI File`,
  });
  if (!fileUris?.length) {
    return;
  }

  // Read file content
  let apiSpec: string;
  try {
    apiSpec = fs.readFileSync(fileUris[0].fsPath, "utf-8");
  } catch (e: any) {
    vscode.window.showErrorMessage(`Could not read file: ${e.message}`);
    return;
  }

  // Step 2: Skill option
  const skillOption = await pickSkillOption();
  if (!skillOption) {
    return;
  }

  // Load skill if needed
  let skill: Skill | null = null;
  if (skillOption.useSkill || skillOption.enhance) {
    skill = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Loading skill...",
      },
      async () => loadSkill(UI_UX_PRO_MAX_SKILL),
    );
  }

  // Step 3: Actions configuration
  let actionsPrompt: string | undefined;

  if (skillOption.useSkill && skill) {
    // Use skill template
    const template = await pickActionsTemplate(skill);
    if (template === undefined) {
      return; // User cancelled
    }
    actionsPrompt = template || undefined;
  } else {
    // Manual input
    const mode = await vscode.window.showQuickPick(
      [
        {
          label: "$(zap) Auto-detect from API",
          description: "Automatically detect actions from API endpoints",
          value: "auto",
        },
        {
          label: "$(edit) Manual prompt",
          description: "Describe actions in natural language",
          value: "manual",
        },
      ],
      {
        title: `${FLOW_NAME} — Step 3 of 5: Actions Configuration`,
        placeHolder: "How do you want to configure actions?",
      },
    );
    if (!mode) {
      return;
    }

    if (mode.value === "manual") {
      actionsPrompt = await vscode.window.showInputBox({
        title: `${FLOW_NAME} — Actions`,
        prompt: "Describe the actions/features you need",
        placeHolder: "e.g. I need to create, view list, and delete products",
        ignoreFocusOut: true,
      });
      if (actionsPrompt === undefined) {
        return;
      }
    }
  }

  // Step 4: Design configuration
  let designPrompt: string | undefined;

  if (skillOption.useSkill && skill) {
    // Use skill template
    const template = await pickDesignTemplate(skill);
    if (template === undefined) {
      return; // User cancelled
    }
    if (template) {
      designPrompt = template;
    } else {
      // Custom input after selecting "Custom"
      designPrompt = await vscode.window.showInputBox({
        title: `${FLOW_NAME} — Design`,
        prompt: "Describe your design preferences",
        placeHolder: "e.g. Dark mode, modern, blue primary color",
        ignoreFocusOut: true,
      });
      if (designPrompt === undefined) {
        return;
      }
    }
  } else {
    // Manual input
    designPrompt = await vscode.window.showInputBox({
      title: `${FLOW_NAME} — Step 4 of 5: Design (Optional)`,
      prompt: "Describe your design preferences",
      placeHolder: "e.g. Dark mode, modern, blue primary color, Tailwind CSS",
      ignoreFocusOut: true,
    });
    if (designPrompt === undefined) {
      return;
    }
  }

  // Enhance prompts if skill is enabled
  let finalActionsPrompt = actionsPrompt?.trim() || undefined;
  let finalDesignPrompt = designPrompt?.trim() || undefined;

  if (skillOption.enhance && skill) {
    if (finalActionsPrompt) {
      finalActionsPrompt = enhanceActionsPrompt(finalActionsPrompt, skill);
    }
    if (finalDesignPrompt) {
      finalDesignPrompt = enhanceDesignPrompt(finalDesignPrompt, skill);
    }
  }

  // Step 5: AI Provider + Model
  const providerModel = await pickProviderAndModel(
    `${FLOW_NAME} — Step 5 of 5: AI Provider`,
  );
  if (!providerModel) {
    return;
  }

  // Create initial state
  const state: PreviewState = {
    apiSpec,
    actionsPrompt: finalActionsPrompt,
    designPrompt: finalDesignPrompt,
    provider: providerModel.provider,
    model: providerModel.model,
    apiFilePath: fileUris[0].fsPath,
    useSkill: skillOption.useSkill || skillOption.enhance,
    skillName: skill?.name,
  };

  // Generate preview
  await generatePreviewAndShow(context, state);
}

/**
 * Generate preview and show in webview
 */
export async function generatePreviewAndShow(
  context: vscode.ExtensionContext,
  state: PreviewState,
): Promise<void> {
  let result: GenerateResult | undefined;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: FLOW_NAME,
      cancellable: false,
    },
    async (progress) => {
      try {
        progress.report({ message: "Generating preview..." });

        result = await generateApi.generatePreview({
          apiSpec: state.apiSpec,
          actionsPrompt: state.actionsPrompt,
          designPrompt: state.designPrompt,
          customPrompt: state.customPrompt,
          provider: state.provider,
          model: state.model,
        });

        if (!result.success) {
          throw new Error("Preview generation failed");
        }
      } catch (e: unknown) {
        vscode.window.showErrorMessage(
          `Preview generation failed: ${extractApiError(e)}`,
        );
      }
    },
  );

  if (!result) {
    return;
  }

  // Show preview webview with action bar
  showPreviewWebview(context, state, result);
}
