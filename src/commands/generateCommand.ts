import * as vscode from "vscode";
import * as path from "path";
import {
  generateApi,
  GenerateResult,
  GenerateChange,
  PromptTemplate,
} from "../api/generate.api";
import { apisApi } from "../api/apis.api";
import { extractApiError } from "../utils/errors";
import { escapeHtml } from "../utils/html";

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

interface GeneratedFile {
  path: string;
  content: string;
  lang: string;
  lines: number;
}

interface ApplyFilesResult {
  root: vscode.Uri;
  written: GeneratedFile[];
  failures: Array<{ path: string; error: string }>;
}

function logGeneratePreview(message: string, data?: unknown) {
  if (data === undefined) {
    console.log(`[uigenai][generate-preview] ${message}`);
    return;
  }
  console.log(`[uigenai][generate-preview] ${message}`, data);
}

function resolveChanges(result: GenerateResult): GenerateChange[] {
  if (Array.isArray(result?.changes) && result.changes.length > 0) {
    return result.changes;
  }

  // Backend may have returned a wrapped payload: { success, data: { changes, summary } }
  const inner = (result as unknown as Record<string, unknown>)?.data;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const wrapped = inner as Record<string, unknown>;
    if (Array.isArray(wrapped.changes)) {
      return wrapped.changes as GenerateChange[];
    }
  }

  return [];
}

function resolveSummary(result: GenerateResult): string {
  if (typeof result?.summary === "string" && result.summary) {
    return result.summary;
  }

  const inner = (result as unknown as Record<string, unknown>)?.data;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const wrapped = inner as Record<string, unknown>;
    if (typeof wrapped.summary === "string") {
      return wrapped.summary;
    }
  }

  return "";
}

function normalizeGeneratedFiles(result: GenerateResult): GeneratedFile[] {
  const rawChanges = resolveChanges(result);

  logGeneratePreview("Generation response shape", {
    success: result?.success,
    summaryType: typeof result?.summary,
    changeCount: rawChanges.length,
    changes: rawChanges.map((change, index) => ({
      index,
      fileName: typeof change?.fileName === "string" ? change.fileName : null,
      codeContentType: typeof change?.codeContent,
      codeContentLength:
        typeof change?.codeContent === "string"
          ? change.codeContent.length
          : null,
      codeContentPreview:
        typeof change?.codeContent === "string"
          ? change.codeContent.slice(0, 200)
          : null,
    })),
  });

  const normalized: GeneratedFile[] = [];
  const seen = new Set<string>();

  for (const change of rawChanges) {
    const extracted = extractGeneratedFilesFromUnknown(change?.codeContent);
    if (extracted.length > 0) {
      for (const file of extracted) {
        if (!seen.has(file.path)) {
          normalized.push(file);
          seen.add(file.path);
        }
      }
      continue;
    }

    // Fallback: treat fileName
    const direct = toGeneratedFile(change?.fileName, change?.codeContent);
    if (direct && !seen.has(direct.path)) {
      normalized.push(direct);
      seen.add(direct.path);
    }
  }

  logGeneratePreview("Parsed files", {
    count: normalized.length,
    files: normalized.map((file) => ({
      path: file.path,
      lang: file.lang,
      lines: file.lines,
    })),
  });

  return normalized;
}

function extractGeneratedFilesFromUnknown(
  value: unknown,
  depth = 0,
): GeneratedFile[] {
  if (depth > 4 || value == null) {
    return [];
  }

  if (typeof value === "string") {
    return extractGeneratedFilesFromString(value, depth + 1);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      extractGeneratedFilesFromUnknown(item, depth + 1),
    );
  }

  if (typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const direct = toGeneratedFile(
    firstString(record, [
      "fileName",
      "filename",
      "file_path",
      "filePath",
      "path",
      "name",
    ]),
    firstString(record, ["codeContent", "content", "code", "value", "source"]),
  );
  if (direct) {
    return [direct];
  }

  for (const key of [
    "files",
    "changes",
    "generatedFiles",
    "output",
    "data",
    "items",
  ]) {
    const nested = extractGeneratedFilesFromUnknown(record[key], depth + 1);
    if (nested.length > 0) {
      return nested;
    }
  }

  const entries = Object.entries(record);
  const mapped = entries
    .map(([key, content]) => toGeneratedFile(key, content))
    .filter((file): file is GeneratedFile => Boolean(file));

  if (mapped.length > 0 && mapped.length === entries.length) {
    return mapped;
  }

  return [];
}

function extractGeneratedFilesFromString(
  value: string,
  depth: number,
): GeneratedFile[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const candidates = [trimmed, stripCodeFence(trimmed)];

  for (const candidate of candidates) {
    if (!looksLikeStructuredPayload(candidate)) {
      continue;
    }

    try {
      const parsed = JSON.parse(candidate);
      const nested = extractGeneratedFilesFromUnknown(parsed, depth + 1);
      if (nested.length > 0) {
        return nested;
      }
    } catch {
      // Ignore and keep trying other candidate forms.
    }
  }

  return [];
}

function stripCodeFence(value: string): string {
  const fenced = value.match(
    /^```(?:json|javascript|js)?\s*([\s\S]*?)\s*```$/i,
  );
  return fenced ? fenced[1].trim() : value;
}

function looksLikeStructuredPayload(value: string): boolean {
  if (
    !(value.startsWith("{") || value.startsWith("[") || value.startsWith('"'))
  ) {
    return false;
  }

  return /(fileName|codeContent|file_path|filePath|generatedFiles|changes|files)/i.test(
    value,
  );
}

/**
 * Detect whether a summary string is actually a serialized payload
 * (raw JSON, code fences, etc.) rather than a human-readable summary.
 * When true the summary should be suppressed in the preview UI because
 * the parsed GeneratedFile[] is already the source of truth.
 */
function looksLikeSerializedPayload(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  if (
    (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
    /(fileName|codeContent|file_path|filePath|generatedFiles)/i.test(trimmed)
  ) {
    return true;
  }

  if (/^```/m.test(trimmed) && trimmed.length > 500) {
    return true;
  }

  return false;
}

function firstString(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    if (typeof record[key] === "string") {
      return record[key] as string;
    }
  }
  return undefined;
}

function toGeneratedFile(
  filePath: unknown,
  content: unknown,
): GeneratedFile | undefined {
  if (typeof filePath !== "string" || typeof content !== "string") {
    return undefined;
  }

  const normalizedPath = sanitizeGeneratedPath(filePath);
  if (!normalizedPath) {
    return undefined;
  }

  return {
    path: normalizedPath,
    content,
    lang: path.extname(normalizedPath).replace(".", "").toUpperCase() || "FILE",
    lines: content.split("\n").length,
  };
}

function sanitizeGeneratedPath(filePath: string): string | undefined {
  const normalized = path.posix
    .normalize(
      filePath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, ""),
    )
    .replace(/^\/+/, "");

  if (!normalized || normalized === "." || normalized.startsWith("../")) {
    return undefined;
  }

  return normalized;
}

function getCurrentWorkspaceRoot(): vscode.Uri | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const currentFolder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (currentFolder) {
      return currentFolder.uri;
    }
  }

  return folders[0].uri;
}

function buildApplyResultMessage(
  result: ApplyFilesResult,
  attemptedCount: number,
): {
  level: "success" | "error";
  message: string;
} {
  if (result.failures.length === 0) {
    return {
      level: "success",
      message: `Applied ${result.written.length} of ${attemptedCount} file(s) to ${result.root.fsPath}.`,
    };
  }

  if (result.written.length === 0) {
    return {
      level: "error",
      message: `Failed to write ${attemptedCount} file(s) to ${result.root.fsPath}: ${result.failures[0].error}`,
    };
  }

  return {
    level: "error",
    message: `Applied ${result.written.length} of ${attemptedCount} file(s) to ${result.root.fsPath}. ${result.failures.length} failed. First error: ${result.failures[0].error}`,
  };
}

export async function generateCmd() {
  //   Prompt source
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
      title: "Quick Generate — Prompt Source",
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
      title: "Quick Generate — Custom Prompt",
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
        title: "Quick Generate — Loading templates...",
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
        detail: t.prompt.length > 120 ? t.prompt.slice(0, 120) + "…" : t.prompt,
        value: t.prompt,
      })),
      {
        title: "Quick Generate — Select Template",
        placeHolder: "Choose a pre-built prompt template",
        matchOnDetail: true,
      },
    );
    if (!picked) {
      return;
    }

    // Allow user to optionally edit the template prompt
    prompt = await vscode.window.showInputBox({
      title: "Quick Generate — Edit Template (optional)",
      prompt:
        "You can customize the template prompt or press Enter to use as-is",
      value: picked.value,
      ignoreFocusOut: true,
    });
  }

  if (!prompt?.trim()) {
    return;
  }

  //  Framework selection
  const framework = await vscode.window.showQuickPick(
    FRAMEWORKS.map((f) => ({ label: f.label, value: f.value })),
    {
      title: "Quick Generate — Framework",
      placeHolder: "Select the frontend framework",
    },
  );
  if (!framework) {
    return;
  }

  //  Design System selection
  const designSystem = await vscode.window.showQuickPick(
    DESIGN_SYSTEMS.map((d) => ({ label: d.label, value: d.value })),
    {
      title: "Quick Generate — Design System",
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
      title: "Quick Generate — AI Provider",
      placeHolder: "Choose the AI provider",
    },
  );
  if (!provider) {
    return;
  }

  const model = await vscode.window.showInputBox({
    title: "Quick Generate — Model",
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

  //  Optional: link to an API
  let apiId: string | undefined;
  const linkApi = await vscode.window.showQuickPick(
    [
      { label: "No, just generate", value: "no" },
      { label: "Yes, save to an API", value: "yes" },
    ],
    {
      title: "Quick Generate — Link to API?",
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
            title: "Quick Generate — Select API",
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

  //  Build final prompt with framework + design system
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
      title: "Quick Generate — Generating code...",
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

  const previewLabel = `${prompt.trim()}  [${framework.label} · ${designSystem.label}]`;
  showPreview(result, previewLabel);
}

function showPreview(result: GenerateResult, prompt: string) {
  const files = normalizeGeneratedFiles(result);
  const rawSummary = resolveSummary(result);

  // --- Render-boundary debug ---
  logGeneratePreview("Render boundary — files", {
    count: files.length,
    paths: files.map((f) => f.path),
    renderMode: files.length > 0 ? "structured" : "empty",
  });
  logGeneratePreview("Render boundary — summary", {
    length: rawSummary.length,
    looksLikePayload: looksLikeSerializedPayload(rawSummary),
    preview: rawSummary.slice(0, 200),
  });

  // If parsed files are available, suppress a summary that is really just the
  // raw serialized payload text (JSON, code fences, etc.).  Only keep genuine
  // human-readable summaries.
  const summary =
    files.length > 0 && looksLikeSerializedPayload(rawSummary)
      ? ""
      : rawSummary;

  const panel = vscode.window.createWebviewPanel(
    "uigenai-preview",
    "Generated Code",
    vscode.ViewColumn.One,
    { enableScripts: true },
  );

  if (!files.length) {
    const message =
      "Could not parse generated files from the response payload.";
    logGeneratePreview(message, {
      summary,
      rawChanges: resolveChanges(result).length,
      rawKeys: Object.keys(result ?? {}),
    });
    vscode.window.showErrorMessage(message);
    panel.webview.html = /*html*/ `<!DOCTYPE html><html><body style="font-family:Segoe UI,sans-serif;padding:24px;background:#121416;color:#fff"><h2>Generated Code</h2><p>${escapeHtml(message)}</p></body></html>`;
    return;
  }

  panel.webview.onDidReceiveMessage(async (msg) => {
    logGeneratePreview("Webview click", msg);

    try {
      switch (msg.type) {
        case "applyAll": {
          logGeneratePreview("Apply All handler — using normalized files", {
            fileCount: files.length,
            paths: files.map((f) => f.path),
          });
          const applyResult = await applyFiles(files);
          const status = buildApplyResultMessage(applyResult, files.length);
          if (status.level === "success") {
            vscode.window.showInformationMessage(status.message);
          } else {
            vscode.window.showErrorMessage(status.message);
          }
          panel.webview.postMessage({ type: "status", ...status });
          break;
        }
        case "applyFile": {
          const file = files[msg.i];
          if (!file) {
            const message = `Could not find generated file at index ${msg.i}.`;
            vscode.window.showErrorMessage(message);
            panel.webview.postMessage({
              type: "status",
              level: "error",
              message,
            });
            break;
          }

          const applyResult = await applyFiles([file]);
          const status = buildApplyResultMessage(applyResult, 1);
          if (status.level === "success") {
            vscode.window.showInformationMessage(status.message);
          } else {
            vscode.window.showErrorMessage(status.message);
          }
          panel.webview.postMessage({ type: "status", ...status });
          break;
        }
        case "copy": {
          const file = files[msg.i];
          if (!file) {
            const message = `Could not find generated file at index ${msg.i}.`;
            vscode.window.showErrorMessage(message);
            panel.webview.postMessage({
              type: "status",
              level: "error",
              message,
            });
            break;
          }

          await vscode.env.clipboard.writeText(file.content);
          const message = `Copied ${file.path} to the clipboard.`;
          vscode.window.showInformationMessage(message);
          panel.webview.postMessage({
            type: "status",
            level: "success",
            message,
          });
          break;
        }
      }
    } catch (e: unknown) {
      const message = `Apply failed: ${extractApiError(e)}`;
      logGeneratePreview("Apply handler failed", { error: message, msg });
      vscode.window.showErrorMessage(message);
      panel.webview.postMessage({ type: "status", level: "error", message });
    }
  });

  // Sanitize the JSON so that embedded </script> or <!-- sequences in
  // generated file content cannot break the HTML parser and silently kill
  // the webview script.  This is the single source of truth for the UI.
  const filesJson = JSON.stringify(
    files.map((file) => ({
      name: file.path,
      content: file.content,
      lang: file.lang,
      lines: file.lines,
    })),
  )
    .replace(/<\//g, "<\\/")
    .replace(/<!--/g, "<\\!--");

  logGeneratePreview("Webview filesJson", {
    fileCount: files.length,
    jsonLength: filesJson.length,
  });

  panel.webview.html = /*html*/ `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#121416;color:#fff;padding:0}
.hd{background:#1c1f21;border-bottom:1px solid rgba(255,255,255,.08);padding:16px 20px;position:sticky;top:0;z-index:10}
.hd-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.hd h2{font-size:16px;font-weight:700}.badge{background:#00a2ad;color:#fff;font-size:10px;padding:2px 6px;border-radius:99px;margin-left:8px}
.prompt{font-size:12px;color:rgba(255,255,255,.5);background:rgba(255,255,255,.04);padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.06)}
.btn{padding:6px 14px;border-radius:6px;border:none;font-size:12px;font-weight:600;cursor:pointer;transition:.15s}
.bp{background:#00a2ad;color:#fff;box-shadow:0 0 12px rgba(0,162,173,.2)}.bp:hover{box-shadow:0 0 20px rgba(0,162,173,.4)}
.bs{background:rgba(255,255,255,.06);color:rgba(255,255,255,.8);border:1px solid rgba(255,255,255,.1)}.bs:hover{background:rgba(255,255,255,.1)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.sm{padding:16px 20px;font-size:12px;color:rgba(255,255,255,.6);border-bottom:1px solid rgba(255,255,255,.06);background:rgba(0,162,173,.03)}
/* Tabs */
.main-tabs{display:flex;gap:0;background:rgba(255,255,255,.05);margin:0 20px;margin-top:12px;border-radius:8px;padding:3px}
.main-tab{flex:1;padding:8px;text-align:center;cursor:pointer;border-radius:6px;font-weight:600;font-size:12px;color:rgba(255,255,255,.5);border:none;background:transparent;transition:.2s}
.main-tab.active{background:#00a2ad;color:#fff;box-shadow:0 0 12px rgba(0,162,173,.3)}
.tab-panel{display:none}.tab-panel.active{display:block}
/* Files list */
.fl{padding:12px 20px}.fi{border:1px solid rgba(255,255,255,.08);border-radius:10px;margin-bottom:10px;overflow:hidden;background:#1c1f21}
.fh{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:rgba(255,255,255,.03);border-bottom:1px solid rgba(255,255,255,.06);cursor:pointer}
.fh:hover{background:rgba(255,255,255,.05)}.fn{font-size:12px;font-weight:600}
.fm{font-size:10px;color:rgba(255,255,255,.35)}.fa{display:flex;gap:4px}
.cb{max-height:350px;overflow:auto;display:none}.cb.open{display:block}
.cb pre{margin:0;padding:14px;font-family:'Cascadia Code','Fira Code',monospace;font-size:11px;line-height:1.5;color:rgba(255,255,255,.85);white-space:pre;overflow-x:auto}
.done{display:none;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.2);color:#4ade80;padding:10px 20px;text-align:center;font-weight:600;font-size:13px}.done.show{display:block}
.err{display:none;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.25);color:#fca5a5;padding:10px 20px;text-align:center;font-weight:600;font-size:13px}.err.show{display:block}
/* Preview */
.preview-container{padding:12px 20px}
.preview-toolbar{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap}
.preview-toolbar .btn{font-size:11px;padding:5px 10px}
.preview-toolbar .btn.active-view{background:#00a2ad;color:#fff}
.preview-frame{width:100%;border:1px solid rgba(255,255,255,.1);border-radius:10px;overflow:hidden;background:#fff;min-height:400px}
.preview-frame iframe{width:100%;height:500px;border:none}
.preview-empty{padding:40px;text-align:center;color:rgba(255,255,255,.4);font-size:13px}
.size-bar{display:flex;gap:6px;align-items:center;margin-bottom:10px}
.size-bar label{font-size:11px;color:rgba(255,255,255,.4)}
.size-bar button{padding:3px 8px;font-size:10px}
</style></head><body>
<div class="done" id="done">Files applied to workspace</div>
<div class="err" id="err"></div>
<div class="hd"><div class="hd-top"><h2>Generated Code<span class="badge" id="cnt"></span></h2>
<button class="btn bp" onclick="applyAll()" id="ab">Apply All</button></div>
<div class="prompt">${escapeHtml(prompt)}</div></div>
${summary ? `<div class="sm">${escapeHtml(summary)}</div>` : ""}
<div class="main-tabs">
<button class="main-tab active" onclick="switchTab('code')">Code</button>
<button class="main-tab" onclick="switchTab('preview')">Live Preview</button>
</div>
<div class="tab-panel active" id="tab-code">
<div class="fl" id="fl"></div>
</div>
<div class="tab-panel" id="tab-preview">
<div class="preview-container">
<div class="size-bar">
<label>Viewport:</label>
<button class="btn bs" onclick="setSize(375,667)">Mobile</button>
<button class="btn bs" onclick="setSize(768,600)">Tablet</button>
<button class="btn bs active-view" onclick="setSize('100%',500)">Desktop</button>
</div>
<div class="preview-toolbar" id="preview-toolbar"></div>
<div class="preview-frame" id="preview-frame">
<div class="preview-empty" id="preview-empty">Select a component file above to preview</div>
<iframe id="preview-iframe" style="display:none" sandbox="allow-scripts"></iframe>
</div>
</div>
</div>
<script>
const vscode=acquireVsCodeApi(),files=${filesJson};
console.log('[uigenai][generate-preview] Webview render — fileCount:', files.length, 'renderMode:', files.length > 0 ? 'structured-files' : 'empty');
document.getElementById('cnt').textContent=files.length+' files';

/* ---- Tab switching ---- */
function switchTab(t){
  document.querySelectorAll('.main-tab').forEach((b,i)=>b.classList.toggle('active',i===(t==='code'?0:1)));
  document.querySelectorAll('.tab-panel').forEach((p,i)=>p.classList.toggle('active',i===(t==='code'?0:1)));
  if(t==='preview') buildPreviewToolbar();
}

/* ---- Code tab ---- */
const fl=document.getElementById('fl');
files.forEach((f,i)=>{const d=document.createElement('div');d.className='fi';d.innerHTML=\`<div class="fh" onclick="tog(\${i})"><div class="fn">\${esc(f.name)}</div><div style="display:flex;align-items:center;gap:10px"><div class="fm">\${f.lang} · \${f.lines} lines</div><div class="fa"><button class="btn bs" style="padding:3px 8px;font-size:10px" onclick="event.stopPropagation();cp(\${i})" title="Copy">Copy</button><button class="btn bs" style="padding:3px 8px;font-size:10px" onclick="event.stopPropagation();af(\${i})" title="Apply">Apply</button></div></div></div><div class="cb" id="c\${i}"><pre>\${esc(f.content)}</pre></div>\`;fl.appendChild(d)});

function tog(i){document.getElementById('c'+i).classList.toggle('open')}
function applyAll(){console.log('[uigenai][generate-preview] click applyAll — fileCount:', files.length, 'files:', files.map(f=>f.name));vscode.postMessage({type:'applyAll'})}
function af(i){console.log('[uigenai][generate-preview] click applyFile', i);vscode.postMessage({type:'applyFile',i})}
function cp(i){console.log('[uigenai][generate-preview] click copy', i);vscode.postMessage({type:'copy',i})}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function showStatus(level,message){
  const ok=document.getElementById('done');
  const err=document.getElementById('err');
  ok.classList.remove('show');
  err.classList.remove('show');
  if(level==='success'){
    ok.textContent=message;
    ok.classList.add('show');
    return;
  }
  err.textContent=message;
  err.classList.add('show');
}

/* ---- Live Preview tab ---- */
const previewable=['.jsx','.tsx','.html','.htm','.vue','.svelte'];
function isPreviewable(name){return previewable.some(e=>name.toLowerCase().endsWith(e))}
let builtToolbar=false;

function buildPreviewToolbar(){
  if(builtToolbar) return;
  builtToolbar=true;
  const tb=document.getElementById('preview-toolbar');
  const pFiles=files.filter(f=>isPreviewable(f.name));
  if(pFiles.length===0){
    // try to render all files combined
    tb.innerHTML='<button class="btn bs active-view" onclick="renderAll()">Render All Files</button>';
    renderAll();
    return;
  }
  pFiles.forEach((f,idx)=>{
    const b=document.createElement('button');
    b.className='btn bs';
    b.textContent=f.name;
    b.onclick=()=>{
      tb.querySelectorAll('.btn').forEach(x=>x.classList.remove('active-view'));
      b.classList.add('active-view');
      renderFile(files.indexOf(f));
    };
    tb.appendChild(b);
  });
  // Also add "Render All" button
  const ba=document.createElement('button');
  ba.className='btn bs';ba.textContent='All Combined';
  ba.onclick=()=>{
    tb.querySelectorAll('.btn').forEach(x=>x.classList.remove('active-view'));
    ba.classList.add('active-view');
    renderAll();
  };
  tb.appendChild(ba);
  // Auto-preview first file
  if(pFiles.length>0){
    tb.children[0].classList.add('active-view');
    renderFile(files.indexOf(pFiles[0]));
  }
}

function jsxToHtml(code){
  // Strip imports, exports, type annotations for preview
  let c=code
    .replace(/^import\\s.*$/gm,'')
    .replace(/^export\\s+(default\\s+)?/gm,'')
    .replace(/^\\s*\\/\\/.*$/gm,'')
    .replace(/interface\\s+\\w+\\s*\\{[^}]*\\}/gs,'')
    .replace(/type\\s+\\w+\\s*=[^;]+;/g,'');

  // Extract component function body - look for return ( ... )
  const fnMatch=c.match(/(?:function\\s+\\w+|const\\s+\\w+\\s*=\\s*(?:\\([^)]*\\)|\\w+)\\s*(?:=>|:\\s*\\w+\\s*=>))\\s*\\{?[\\s\\S]*?return\\s*\\(([\\s\\S]*?)\\);?\\s*\\}?\\s*;?\\s*$/m);
  let jsx=fnMatch?fnMatch[1]:c;

  // Convert JSX to HTML-ish
  jsx=jsx
    .replace(/className=/g,'class=')
    .replace(/htmlFor=/g,'for=')
    .replace(/\\{[^}]*\\}/g,'')          // Remove JS expressions {var}
    .replace(/onClick=[^\\s>]*/g,'')
    .replace(/onChange=[^\\s>]*/g,'')
    .replace(/onSubmit=[^\\s>]*/g,'')
    .replace(/on[A-Z]\\w*=[^\\s>]*/g,'')
    .replace(/<>|<\\/>/g,'')              // Remove fragments
    .trim();
  return jsx;
}

function buildPreviewHtml(htmlContent, cssContent){
  return \`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI','Inter',system-ui,sans-serif;padding:16px;background:#fff;color:#1a1a2e}
\${cssContent}
</style></head><body>\${htmlContent}</body></html>\`;
}

function renderFile(idx){
  const f=files[idx];
  const iframe=document.getElementById('preview-iframe');
  const empty=document.getElementById('preview-empty');
  empty.style.display='none';
  iframe.style.display='block';

  let html='',css='';
  // Collect CSS files
  files.forEach(ff=>{
    if(ff.name.endsWith('.css')) css+=ff.content+'\\n';
  });

  const ext=f.name.toLowerCase();
  if(ext.endsWith('.html')||ext.endsWith('.htm')){
    html=f.content;
    iframe.srcdoc=html; // Use full HTML as-is
    return;
  }
  // JSX/TSX/Vue → convert
  html=jsxToHtml(f.content);
  iframe.srcdoc=buildPreviewHtml(html,css);
}

function renderAll(){
  const iframe=document.getElementById('preview-iframe');
  const empty=document.getElementById('preview-empty');
  empty.style.display='none';
  iframe.style.display='block';
  let html='',css='';
  files.forEach(f=>{
    if(f.name.endsWith('.css')){css+=f.content+'\\n';return;}
    if(f.name.endsWith('.html')||f.name.endsWith('.htm')){html+=f.content+'\\n';return;}
    if(isPreviewable(f.name)){html+='<div style="margin-bottom:24px;padding-bottom:24px;border-bottom:1px solid #eee">'+jsxToHtml(f.content)+'</div>';}
  });
  iframe.srcdoc=buildPreviewHtml(html,css);
}

function setSize(w,h){
  const iframe=document.getElementById('preview-iframe');
  iframe.style.width=typeof w==='number'?w+'px':w;
  iframe.style.height=typeof h==='number'?h+'px':h;
  document.querySelectorAll('.size-bar .btn').forEach(b=>b.classList.remove('active-view'));
  event.target.classList.add('active-view');
}

window.addEventListener('message',e=>{
  if(e.data.type==='status'){
    showStatus(e.data.level,e.data.message);
    if(e.data.level==='success'&&e.data.message.includes('Applied')){
      const b=document.getElementById('ab');
      b.disabled=false;
      b.textContent='Apply All';
    }
  }
})
</script></body></html>`;
}

async function applyFiles(files: GeneratedFile[]): Promise<ApplyFilesResult> {
  const base = getCurrentWorkspaceRoot();
  if (!base) {
    throw new Error(
      "Open a workspace folder first before applying generated files.",
    );
  }

  logGeneratePreview("Workspace root", {
    fsPath: base.fsPath,
    fileCount: files.length,
  });

  const result: ApplyFilesResult = {
    root: base,
    written: [],
    failures: [],
  };

  for (const file of files) {
    const relativePath = sanitizeGeneratedPath(file.path);
    if (!relativePath) {
      const error = "Invalid generated file path.";
      result.failures.push({ path: file.path, error });
      logGeneratePreview("File write failed", { path: file.path, error });
      continue;
    }

    const fileUri = vscode.Uri.joinPath(base, ...relativePath.split("/"));
    const dirName = path.posix.dirname(relativePath);

    try {
      if (dirName && dirName !== ".") {
        await vscode.workspace.fs.createDirectory(
          vscode.Uri.joinPath(base, ...dirName.split("/")),
        );
      }

      await vscode.workspace.fs.writeFile(
        fileUri,
        Buffer.from(file.content, "utf-8"),
      );
      result.written.push(file);
    } catch (e: unknown) {
      const error = extractApiError(e);
      result.failures.push({ path: relativePath, error });
      logGeneratePreview("File write failed", {
        path: relativePath,
        workspaceRoot: base.fsPath,
        error,
      });
    }
  }

  if (result.written[0]) {
    try {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.joinPath(base, ...result.written[0].path.split("/")),
      );
      await vscode.window.showTextDocument(doc);
    } catch (e: unknown) {
      logGeneratePreview("Failed to open first written file", {
        path: result.written[0].path,
        error: extractApiError(e),
      });
    }
  }

  return result;
}
