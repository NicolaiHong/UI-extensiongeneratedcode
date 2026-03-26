/**
 * Preview Webview with Action Bar
 *
 * Enhanced webview for preview-first flow with:
 * - Regenerate Preview
 * - Refine Prompt
 * - Change Design
 * - Generate Full Code
 * - Viewport size controls
 * - Discard
 */

import * as vscode from "vscode";
import { GenerateResult } from "../api/generate.api";
import { escapeHtml } from "./html";
import {
  normalizeGeneratedFiles,
  resolveSummary,
  applyFiles,
  buildApplyResultMessage,
  GeneratedFile,
  getCurrentWorkspaceRoot,
} from "./previewPanel";
import { quickValidate, showValidationResults } from "./codeValidator";
import { showErrorFixPanel } from "./errorFixPanel";
import { pickDeployPlatform, deployFiles, showDeployResult } from "./deployService";

export interface PreviewState {
  apiSpec: string;
  actionsPrompt?: string;
  designPrompt?: string;
  customPrompt?: string;
  provider: string;
  model: string;
  apiFilePath?: string;
  framework?: string;
  cssStrategy?: string;
  useSkill?: boolean;
  skillName?: string;
}

let currentPanel: vscode.WebviewPanel | undefined;

/**
 * Show preview webview with action bar
 */
export function showPreviewWebview(
  context: vscode.ExtensionContext,
  state: PreviewState,
  result: GenerateResult,
): void {
  // Dispose existing panel if any
  if (currentPanel) {
    currentPanel.dispose();
  }

  const files = normalizeGeneratedFiles(result);
  const summary = resolveSummary(result);

  currentPanel = vscode.window.createWebviewPanel(
    "uigenai-preview-flow",
    "UI Preview",
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  // Handle messages from webview
  currentPanel.webview.onDidReceiveMessage(
    async (msg) => {
      switch (msg.type) {
        case "regenerate":
          await handleRegenerate(context, state);
          break;
        case "refinePrompt":
          await handleRefinePrompt(context, state);
          break;
        case "changeDesign":
          await handleChangeDesign(context, state);
          break;
        case "generateFull":
          await handleGenerateFull(context, state, files);
          break;
        case "applyAll":
          await handleApplyAll(files);
          break;
        case "applyFile":
          await handleApplyFile(files, msg.i);
          break;
        case "copy":
          await handleCopy(files, msg.i);
          break;
        case "deploy":
          await handleDeploy(context, files);
          break;
        case "discard":
          currentPanel?.dispose();
          break;
      }
    },
    undefined,
    context.subscriptions,
  );

  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
  });

  // Render HTML
  currentPanel.webview.html = buildPreviewHtml(files, summary, state);
}

async function handleRegenerate(
  context: vscode.ExtensionContext,
  state: PreviewState,
): Promise<void> {
  const { generatePreviewAndShow } =
    await import("../commands/previewGenerateCommand");
  await generatePreviewAndShow(context, state);
}

async function handleRefinePrompt(
  context: vscode.ExtensionContext,
  state: PreviewState,
): Promise<void> {
  const newPrompt = await vscode.window.showInputBox({
    title: "Refine Your Prompt",
    prompt: "Update your requirements",
    value: state.customPrompt || state.actionsPrompt || "",
    ignoreFocusOut: true,
  });

  if (newPrompt === undefined) {
    return;
  }

  const newState: PreviewState = {
    ...state,
    customPrompt: newPrompt.trim() || undefined,
  };

  const { generatePreviewAndShow } =
    await import("../commands/previewGenerateCommand");
  await generatePreviewAndShow(context, newState);
}

async function handleChangeDesign(
  context: vscode.ExtensionContext,
  state: PreviewState,
): Promise<void> {
  const newDesign = await vscode.window.showInputBox({
    title: "Change Design",
    prompt: "Describe your new design preferences",
    value: state.designPrompt || "",
    placeHolder: "e.g. Light mode, minimalist, green accent",
    ignoreFocusOut: true,
  });

  if (newDesign === undefined) {
    return;
  }

  const newState: PreviewState = {
    ...state,
    designPrompt: newDesign.trim() || undefined,
  };

  const { generatePreviewAndShow } =
    await import("../commands/previewGenerateCommand");
  await generatePreviewAndShow(context, newState);
}

async function handleGenerateFull(
  _context: vscode.ExtensionContext,
  state: PreviewState,
  previewFiles: GeneratedFile[],
): Promise<void> {
  const confirm = await vscode.window.showInformationMessage(
    "Generate full production code from this preview?",
    { modal: true },
    "Generate",
    "Cancel",
  );

  if (confirm !== "Generate") {
    return;
  }

  // For now, apply the preview files
  // In the future, this would call the full generation API
  vscode.window.showInformationMessage(
    "Full code generation will use the session-based flow. For now, applying preview files...",
  );

  await handleApplyAll(previewFiles);
}

async function handleApplyAll(files: GeneratedFile[]): Promise<void> {
  try {
    const result = await applyFiles(files);
    const status = buildApplyResultMessage(result, files.length);
    if (status.level === "success") {
      vscode.window.showInformationMessage(status.message);
    } else {
      vscode.window.showErrorMessage(status.message);
    }
    currentPanel?.webview.postMessage({ type: "status", ...status });
  } catch (e: any) {
    vscode.window.showErrorMessage(`Apply failed: ${e.message}`);
  }
}

async function handleApplyFile(
  files: GeneratedFile[],
  index: number,
): Promise<void> {
  const file = files[index];
  if (!file) {
    vscode.window.showErrorMessage(`File not found at index ${index}`);
    return;
  }

  try {
    const result = await applyFiles([file]);
    const status = buildApplyResultMessage(result, 1);
    if (status.level === "success") {
      vscode.window.showInformationMessage(status.message);
    } else {
      vscode.window.showErrorMessage(status.message);
    }
    currentPanel?.webview.postMessage({ type: "status", ...status });
  } catch (e: any) {
    vscode.window.showErrorMessage(`Apply failed: ${e.message}`);
  }
}

async function handleCopy(
  files: GeneratedFile[],
  index: number,
): Promise<void> {
  const file = files[index];
  if (!file) {
    vscode.window.showErrorMessage(`File not found at index ${index}`);
    return;
  }

  await vscode.env.clipboard.writeText(file.content);
  vscode.window.showInformationMessage(`Copied ${file.path} to clipboard`);
}

/**
 * Handle deploy with validation
 */
async function handleDeploy(
  context: vscode.ExtensionContext,
  files: GeneratedFile[],
): Promise<void> {
  const config = vscode.workspace.getConfiguration("uigenai");
  const validateBeforeDeploy = config.get<boolean>("validateBeforeDeploy", true);

  // Step 1: Validate code if enabled
  if (validateBeforeDeploy) {
    currentPanel?.webview.postMessage({
      type: "status",
      level: "info",
      message: "Validating code...",
    });

    const validationResult = quickValidate(files);

    if (!validationResult.success) {
      // Show validation results and ask user what to do
      const action = await showValidationResults(validationResult);

      if (action === "fix") {
        // Show error fix panel
        showErrorFixPanel(context, files, validationResult.errors, async (fixedFiles) => {
          // Re-validate and deploy
          const revalidation = quickValidate(fixedFiles);
          if (revalidation.success) {
            await proceedWithDeploy(fixedFiles);
          } else {
            vscode.window.showWarningMessage("Some errors remain. Please fix them before deploying.");
          }
        });
        return;
      } else if (action === "cancel") {
        return;
      }
      // action === "ignore" - continue with deploy
    }
  }

  // Step 2: Proceed with deploy
  await proceedWithDeploy(files);
}

/**
 * Proceed with deployment after validation
 */
async function proceedWithDeploy(files: GeneratedFile[]): Promise<void> {
  // Pick deploy platform
  const deployConfig = await pickDeployPlatform();
  if (!deployConfig) {
    return;
  }

  // Deploy
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Deploying to ${deployConfig.platform}...`,
      cancellable: false,
    },
    async () => {
      const result = await deployFiles(files, deployConfig);
      showDeployResult(result);

      if (result.success) {
        currentPanel?.webview.postMessage({
          type: "status",
          level: "success",
          message: `Deployed to ${result.url}`,
        });
      }
    },
  );
}

function buildPreviewHtml(
  files: GeneratedFile[],
  summary: string,
  state: PreviewState,
): string {
  const filesJson = JSON.stringify(
    files.map((f) => ({
      name: f.path,
      content: f.content,
      lang: f.lang,
      lines: f.lines,
    })),
  )
    .replace(/<\//g, "<\\/")
    .replace(/<!--/g, "<\\!--");

  const stateInfo = [
    state.useSkill ? `Skill: ${state.skillName || "ui-ux-pro-max"}` : null,
    state.actionsPrompt
      ? `Actions: ${state.actionsPrompt.slice(0, 40)}...`
      : "Actions: Auto-detect",
    state.designPrompt
      ? `Design: ${state.designPrompt.slice(0, 40)}...`
      : "Design: Default",
    `Provider: ${state.provider} / ${state.model}`,
  ].filter(Boolean).join(" | ");

  return /*html*/ `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', sans-serif; background: #0d1117; color: #e6edf3; }

    /* Action Bar */
    .action-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      background: #161b22;
      border-bottom: 1px solid #30363d;
      position: sticky;
      top: 0;
      z-index: 100;
      flex-wrap: wrap;
    }
    .action-bar .title {
      font-size: 14px;
      font-weight: 600;
      margin-right: auto;
    }
    .btn {
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid #30363d;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      background: #21262d;
      color: #e6edf3;
    }
    .btn:hover { background: #30363d; }
    .btn-primary { background: #238636; border-color: #238636; color: #fff; }
    .btn-primary:hover { background: #2ea043; }
    .btn-danger { background: #da3633; border-color: #da3633; color: #fff; }
    .btn-danger:hover { background: #f85149; }
    .btn-accent { background: #1f6feb; border-color: #1f6feb; color: #fff; }
    .btn-accent:hover { background: #388bfd; }

    /* State Info */
    .state-info {
      padding: 8px 20px;
      background: #161b22;
      font-size: 11px;
      color: #8b949e;
      border-bottom: 1px solid #30363d;
    }

    /* Summary */
    .summary {
      padding: 12px 20px;
      background: rgba(56, 139, 253, 0.1);
      border-bottom: 1px solid #30363d;
      font-size: 12px;
      color: #8b949e;
    }

    /* Live Preview */
    .preview-section {
      padding: 20px;
    }
    .preview-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }
    .preview-header h3 {
      font-size: 14px;
      font-weight: 600;
    }
    .viewport-btns {
      display: flex;
      gap: 4px;
    }
    .viewport-btns .btn {
      padding: 4px 8px;
      font-size: 10px;
    }
    .viewport-btns .btn.active { background: #1f6feb; border-color: #1f6feb; }
    .preview-frame {
      background: #fff;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #30363d;
    }
    .preview-frame iframe {
      width: 100%;
      height: 450px;
      border: none;
    }

    /* File List */
    .files-section {
      padding: 0 20px 20px;
    }
    .files-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .files-header h3 {
      font-size: 14px;
      font-weight: 600;
    }
    .badge {
      background: #238636;
      color: #fff;
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 10px;
    }
    .file-item {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      margin-bottom: 8px;
      overflow: hidden;
    }
    .file-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .file-header:hover { background: #21262d; }
    .file-name { font-size: 12px; font-weight: 500; }
    .file-meta { font-size: 10px; color: #8b949e; }
    .file-actions { display: flex; gap: 4px; }
    .file-content {
      display: none;
      max-height: 300px;
      overflow: auto;
      border-top: 1px solid #30363d;
    }
    .file-content.open { display: block; }
    .file-content pre {
      margin: 0;
      padding: 14px;
      font-family: 'Cascadia Code', 'Fira Code', monospace;
      font-size: 11px;
      line-height: 1.5;
      color: #e6edf3;
      white-space: pre;
    }

    /* Status */
    .status {
      display: none;
      padding: 10px 20px;
      font-size: 12px;
      font-weight: 500;
    }
    .status.show { display: block; }
    .status.success { background: rgba(35, 134, 54, 0.2); color: #3fb950; }
    .status.error { background: rgba(218, 54, 51, 0.2); color: #f85149; }
  </style>
</head>
<body>
  <div class="status" id="status"></div>

  <div class="action-bar">
    <span class="title">UI Preview</span>
    <button class="btn" onclick="regenerate()">Regenerate</button>
    <button class="btn" onclick="refinePrompt()">Refine Prompt</button>
    <button class="btn" onclick="changeDesign()">Change Design</button>
    <button class="btn btn-primary" onclick="generateFull()">Generate Full Code</button>
    <button class="btn btn-accent" onclick="deploy()">🚀 Deploy</button>
    <button class="btn" onclick="applyAll()">Apply All</button>
    <button class="btn btn-danger" onclick="discard()">Discard</button>
  </div>

  <div class="state-info">${escapeHtml(stateInfo)}</div>

  ${summary ? `<div class="summary">${escapeHtml(summary)}</div>` : ""}

  <div class="preview-section">
    <div class="preview-header">
      <h3>Live Preview</h3>
      <div class="viewport-btns">
        <button class="btn" onclick="setSize(375, 667)">Mobile</button>
        <button class="btn" onclick="setSize(768, 500)">Tablet</button>
        <button class="btn active" onclick="setSize('100%', 450)">Desktop</button>
      </div>
    </div>
    <div class="preview-frame">
      <iframe id="preview-iframe" sandbox="allow-scripts"></iframe>
    </div>
  </div>

  <div class="files-section">
    <div class="files-header">
      <h3>Generated Files</h3>
      <span class="badge" id="file-count"></span>
    </div>
    <div id="file-list"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const files = ${filesJson};

    document.getElementById('file-count').textContent = files.length + ' files';

    // Render file list
    const list = document.getElementById('file-list');
    files.forEach((f, i) => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = \`
        <div class="file-header" onclick="toggleFile(\${i})">
          <div>
            <div class="file-name">\${esc(f.name)}</div>
            <div class="file-meta">\${f.lang} · \${f.lines} lines</div>
          </div>
          <div class="file-actions">
            <button class="btn" onclick="event.stopPropagation();copy(\${i})">Copy</button>
            <button class="btn" onclick="event.stopPropagation();applyFile(\${i})">Apply</button>
          </div>
        </div>
        <div class="file-content" id="content-\${i}">
          <pre>\${esc(f.content)}</pre>
        </div>
      \`;
      list.appendChild(item);
    });

    // Auto-render preview
    renderPreview();

    function toggleFile(i) {
      document.getElementById('content-' + i).classList.toggle('open');
    }

    function renderPreview() {
      const iframe = document.getElementById('preview-iframe');
      // Find HTML file or first previewable file
      const htmlFile = files.find(f => f.name.endsWith('.html'));
      if (htmlFile) {
        iframe.srcdoc = htmlFile.content;
        return;
      }
      // Fallback: combine all files
      let html = '<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"><\\/script></head><body class="p-4">';
      files.forEach(f => {
        if (f.name.endsWith('.css')) return;
        html += '<div class="mb-4 p-4 border rounded">' + esc(f.content.slice(0, 500)) + '...</div>';
      });
      html += '</body></html>';
      iframe.srcdoc = html;
    }

    function setSize(w, h) {
      const iframe = document.getElementById('preview-iframe');
      iframe.style.width = typeof w === 'number' ? w + 'px' : w;
      iframe.style.height = typeof h === 'number' ? h + 'px' : h;
      document.querySelectorAll('.viewport-btns .btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
    }

    function regenerate() { vscode.postMessage({ type: 'regenerate' }); }
    function refinePrompt() { vscode.postMessage({ type: 'refinePrompt' }); }
    function changeDesign() { vscode.postMessage({ type: 'changeDesign' }); }
    function generateFull() { vscode.postMessage({ type: 'generateFull' }); }
    function deploy() { vscode.postMessage({ type: 'deploy' }); }
    function applyAll() { vscode.postMessage({ type: 'applyAll' }); }
    function applyFile(i) { vscode.postMessage({ type: 'applyFile', i }); }
    function copy(i) { vscode.postMessage({ type: 'copy', i }); }
    function discard() { vscode.postMessage({ type: 'discard' }); }

    function esc(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function showStatus(level, message) {
      const el = document.getElementById('status');
      el.className = 'status show ' + level;
      el.textContent = message;
      setTimeout(() => el.classList.remove('show'), 5000);
    }

    window.addEventListener('message', e => {
      if (e.data.type === 'status') {
        showStatus(e.data.level, e.data.message);
      }
    });
  </script>
</body>
</html>`;
}
