/**
 * Error Fix Panel - Collaborative Error Fixing UI
 *
 * Shows errors and allows:
 * - AI Fix: AI suggests and applies fixes
 * - Manual Fix: User edits code directly
 * - Hybrid: AI suggests, user reviews and edits
 */

import * as vscode from "vscode";
import { GeneratedFile } from "./previewPanel";
import { ValidationError } from "./codeValidator";
import { generateApi } from "../api/generate.api";
import { escapeHtml } from "./html";

export interface FixSuggestion {
  error: ValidationError;
  file: string;
  oldCode: string;
  newCode: string;
  explanation: string;
}

let errorFixPanel: vscode.WebviewPanel | undefined;

/**
 * Show error fix panel with collaborative fixing options
 */
export function showErrorFixPanel(
  context: vscode.ExtensionContext,
  files: GeneratedFile[],
  errors: ValidationError[],
  onFixed: (fixedFiles: GeneratedFile[]) => void,
): void {
  if (errorFixPanel) {
    errorFixPanel.dispose();
  }

  errorFixPanel = vscode.window.createWebviewPanel(
    "uigenai-error-fix",
    "Fix Errors",
    vscode.ViewColumn.One,
    { enableScripts: true },
  );

  let currentFiles = [...files];
  let fixSuggestions: FixSuggestion[] = [];

  errorFixPanel.webview.onDidReceiveMessage(
    async (msg) => {
      switch (msg.type) {
        case "aiFixAll":
          await handleAiFixAll(errors, currentFiles, context);
          break;
        case "aiFixSingle":
          await handleAiFixSingle(
            msg.errorIndex,
            errors,
            currentFiles,
            context,
          );
          break;
        case "editFile":
          await handleEditFile(msg.file, currentFiles);
          break;
        case "applyFix":
          currentFiles = applyFixToFiles(currentFiles, msg.fix);
          updatePanel(currentFiles, errors);
          break;
        case "revalidate":
          onFixed(currentFiles);
          errorFixPanel?.dispose();
          break;
        case "ignoreContinue":
          onFixed(currentFiles);
          errorFixPanel?.dispose();
          break;
        case "cancel":
          errorFixPanel?.dispose();
          break;
      }
    },
    undefined,
    context.subscriptions,
  );

  errorFixPanel.onDidDispose(() => {
    errorFixPanel = undefined;
  });

  function updatePanel(files: GeneratedFile[], errs: ValidationError[]) {
    if (errorFixPanel) {
      errorFixPanel.webview.html = buildErrorFixHtml(
        files,
        errs,
        fixSuggestions,
      );
    }
  }

  async function handleAiFixAll(
    errs: ValidationError[],
    files: GeneratedFile[],
    ctx: vscode.ExtensionContext,
  ) {
    errorFixPanel?.webview.postMessage({
      type: "loading",
      message: "AI is analyzing errors...",
    });

    try {
      const suggestions = await getAiFixSuggestions(errs, files);
      fixSuggestions = suggestions;
      updatePanel(files, errs);
    } catch (e: any) {
      vscode.window.showErrorMessage(`AI fix failed: ${e.message}`);
    }
  }

  async function handleAiFixSingle(
    errorIndex: number,
    errs: ValidationError[],
    files: GeneratedFile[],
    ctx: vscode.ExtensionContext,
  ) {
    const error = errs[errorIndex];
    if (!error) return;

    errorFixPanel?.webview.postMessage({
      type: "loading",
      message: `AI is fixing: ${error.message}`,
    });

    try {
      const suggestions = await getAiFixSuggestions([error], files);
      if (suggestions.length > 0) {
        fixSuggestions = [...fixSuggestions, ...suggestions];
        updatePanel(files, errs);
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`AI fix failed: ${e.message}`);
    }
  }

  async function handleEditFile(filePath: string, files: GeneratedFile[]) {
    const file = files.find((f) => f.path === filePath);
    if (!file) return;

    // Open file in VS Code editor
    const doc = await vscode.workspace.openTextDocument({
      content: file.content,
      language: getLanguageId(filePath),
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);

    vscode.window.showInformationMessage(
      "Edit the file, then copy the content back to apply changes.",
    );
  }

  // Initial render
  errorFixPanel.webview.html = buildErrorFixHtml(
    currentFiles,
    errors,
    fixSuggestions,
  );
}

/**
 * Get AI fix suggestions for errors
 */
async function getAiFixSuggestions(
  errors: ValidationError[],
  files: GeneratedFile[],
): Promise<FixSuggestion[]> {
  // Build context for AI
  const errorContext = errors
    .map((e) => `- ${e.file}${e.line ? `:${e.line}` : ""}: ${e.message}`)
    .join("\n");

  const fileContext = files
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 2000)}\n\`\`\``)
    .join("\n\n");

  const prompt = `Fix these errors in the generated code:

${errorContext}

Files:
${fileContext}

For each error, provide a fix in this JSON format:
{
  "fixes": [
    {
      "file": "path/to/file.tsx",
      "oldCode": "the problematic code snippet",
      "newCode": "the fixed code snippet",
      "explanation": "what was wrong and how it was fixed"
    }
  ]
}`;

  try {
    const result = await generateApi.generate({
      prompt,
      provider: "openai",
      model: "gpt-4o",
    });

    // Parse AI response
    if (result.summary) {
      const jsonMatch = result.summary.match(/\{[\s\S]*"fixes"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.fixes.map((fix: any, idx: number) => ({
          error: errors[idx] || errors[0],
          file: fix.file,
          oldCode: fix.oldCode,
          newCode: fix.newCode,
          explanation: fix.explanation,
        }));
      }
    }
  } catch (e) {
    console.error("AI fix suggestion failed:", e);
  }

  return [];
}

/**
 * Apply a fix to files
 */
function applyFixToFiles(
  files: GeneratedFile[],
  fix: FixSuggestion,
): GeneratedFile[] {
  return files.map((f) => {
    if (f.path === fix.file) {
      return {
        ...f,
        content: f.content.replace(fix.oldCode, fix.newCode),
      };
    }
    return f;
  });
}

/**
 * Get VS Code language ID from file path
 */
function getLanguageId(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescriptreact",
    js: "javascript",
    jsx: "javascriptreact",
    json: "json",
    css: "css",
    html: "html",
  };
  return map[ext || ""] || "plaintext";
}

/**
 * Build Error Fix Panel HTML
 */
function buildErrorFixHtml(
  files: GeneratedFile[],
  errors: ValidationError[],
  suggestions: FixSuggestion[],
): string {
  const errorsJson = JSON.stringify(errors);
  const suggestionsJson = JSON.stringify(suggestions)
    .replace(/<\//g, "<\\/")
    .replace(/<!--/g, "<\\!--");

  return /*html*/ `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', sans-serif; background: #1e1e1e; color: #d4d4d4; padding: 20px; }

    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .header h2 { color: #f14c4c; }
    .header .count { background: #f14c4c; color: white; padding: 4px 12px; border-radius: 12px; font-size: 14px; }

    .actions { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
    .btn { padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
    .btn-primary { background: #0e639c; color: white; }
    .btn-primary:hover { background: #1177bb; }
    .btn-success { background: #388a34; color: white; }
    .btn-success:hover { background: #45a049; }
    .btn-secondary { background: #3c3c3c; color: #d4d4d4; }
    .btn-secondary:hover { background: #4c4c4c; }
    .btn-danger { background: #f14c4c; color: white; }
    .btn-danger:hover { background: #d73a3a; }

    .error-list { display: flex; flex-direction: column; gap: 12px; }
    .error-item { background: #2d2d2d; border-radius: 8px; border-left: 4px solid #f14c4c; overflow: hidden; }
    .error-header { padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; }
    .error-info { flex: 1; }
    .error-file { font-size: 12px; color: #9cdcfe; margin-bottom: 4px; }
    .error-message { font-size: 13px; color: #f14c4c; }
    .error-actions { display: flex; gap: 6px; }

    .suggestion { background: #1e3a1e; border-left-color: #388a34; }
    .suggestion-content { padding: 0 16px 16px; }
    .diff { font-family: 'Cascadia Code', monospace; font-size: 12px; margin-top: 8px; }
    .diff-old { background: #4b1818; padding: 8px; border-radius: 4px; margin-bottom: 4px; }
    .diff-new { background: #1e3a1e; padding: 8px; border-radius: 4px; }
    .diff-label { font-size: 10px; color: #888; margin-bottom: 2px; }
    .explanation { font-size: 12px; color: #9cdcfe; margin-top: 8px; padding: 8px; background: #252526; border-radius: 4px; }

    .loading { text-align: center; padding: 40px; color: #888; }
    .loading::after { content: '...'; animation: dots 1.5s infinite; }
    @keyframes dots { 0%, 20% { content: '.'; } 40% { content: '..'; } 60%, 100% { content: '...'; } }

    .empty { text-align: center; padding: 40px; color: #388a34; }
    .empty h3 { margin-bottom: 10px; }
  </style>
</head>
<body>
  <div class="header">
    <h2>Code Errors</h2>
    <span class="count">${errors.length} error(s)</span>
  </div>

  <div class="actions">
    <button class="btn btn-primary" onclick="aiFixAll()">🤖 AI Fix All</button>
    <button class="btn btn-secondary" onclick="revalidate()">🔄 Re-validate</button>
    <button class="btn btn-success" onclick="ignoreContinue()">✅ Continue Anyway</button>
    <button class="btn btn-danger" onclick="cancel()">❌ Cancel</button>
  </div>

  <div id="loading" class="loading" style="display: none;">AI is analyzing</div>

  <div id="error-list" class="error-list">
    ${
      errors.length === 0
        ? '<div class="empty"><h3>✅ No errors!</h3><p>Code is ready to deploy.</p></div>'
        : errors
            .map(
              (err, idx) => `
      <div class="error-item ${suggestions.find((s) => s.error === err) ? "suggestion" : ""}">
        <div class="error-header">
          <div class="error-info">
            <div class="error-file">${escapeHtml(err.file)}${err.line ? `:${err.line}` : ""}</div>
            <div class="error-message">${escapeHtml(err.message)}</div>
          </div>
          <div class="error-actions">
            <button class="btn btn-primary" onclick="aiFixSingle(${idx})">🤖 AI Fix</button>
            <button class="btn btn-secondary" onclick="editFile('${escapeHtml(err.file)}')">✏️ Edit</button>
          </div>
        </div>
        ${
          suggestions.find((s) => s.file === err.file)
            ? `
          <div class="suggestion-content">
            <div class="diff">
              <div class="diff-label">- Remove:</div>
              <div class="diff-old">${escapeHtml(suggestions.find((s) => s.file === err.file)!.oldCode)}</div>
              <div class="diff-label">+ Replace with:</div>
              <div class="diff-new">${escapeHtml(suggestions.find((s) => s.file === err.file)!.newCode)}</div>
            </div>
            <div class="explanation">${escapeHtml(suggestions.find((s) => s.file === err.file)!.explanation)}</div>
            <div style="margin-top: 12px; display: flex; gap: 8px;">
              <button class="btn btn-success" onclick="applyFix(${idx})">✅ Apply Fix</button>
              <button class="btn btn-secondary" onclick="editFix(${idx})">✏️ Edit Fix</button>
            </div>
          </div>
        `
            : ""
        }
      </div>
    `,
            )
            .join("")
    }
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const errors = ${errorsJson};
    const suggestions = ${suggestionsJson};

    function aiFixAll() {
      document.getElementById('loading').style.display = 'block';
      vscode.postMessage({ type: 'aiFixAll' });
    }

    function aiFixSingle(idx) {
      document.getElementById('loading').style.display = 'block';
      vscode.postMessage({ type: 'aiFixSingle', errorIndex: idx });
    }

    function editFile(file) {
      vscode.postMessage({ type: 'editFile', file });
    }

    function applyFix(idx) {
      const fix = suggestions.find(s => s.error === errors[idx]) || suggestions[idx];
      if (fix) {
        vscode.postMessage({ type: 'applyFix', fix });
      }
    }

    function editFix(idx) {
      // TODO: Open fix editor
    }

    function revalidate() {
      vscode.postMessage({ type: 'revalidate' });
    }

    function ignoreContinue() {
      vscode.postMessage({ type: 'ignoreContinue' });
    }

    function cancel() {
      vscode.postMessage({ type: 'cancel' });
    }

    window.addEventListener('message', e => {
      if (e.data.type === 'loading') {
        document.getElementById('loading').textContent = e.data.message;
        document.getElementById('loading').style.display = 'block';
      }
    });
  </script>
</body>
</html>`;
}
