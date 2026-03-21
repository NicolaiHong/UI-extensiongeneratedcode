import * as vscode from "vscode";
import { Session } from "../api/sessions.api";
import { escapeHtml } from "./html";

interface PreviewReviewOptions {
  apiName: string;
  session: Session;
  onGenerateFull?: () => Promise<void> | void;
  onRegenerate?: () => Promise<void> | void;
}

function stripScripts(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "");
}

export function showPreviewReviewPanel(opts: PreviewReviewOptions): void {
  const panel = vscode.window.createWebviewPanel(
    "uigenai-preview-review",
    `Preview — ${opts.apiName}`,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  const raw = opts.session.output_summary_md || "<p>No preview HTML returned.</p>";
  const sanitized = stripScripts(raw);
  const createdAt = new Date(opts.session.created_at).toLocaleString();
  const status = opts.session.status;

  panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.type) {
      case "copy":
        await vscode.env.clipboard.writeText(raw);
        vscode.window.showInformationMessage("Preview HTML copied to clipboard.");
        break;
      case "generateFull":
        if (opts.onGenerateFull) {
          await opts.onGenerateFull();
        } else {
          vscode.window.showWarningMessage("Full source generation is not available.");
        }
        break;
      case "regenerate":
        if (opts.onRegenerate) {
          await opts.onRegenerate();
        } else {
          vscode.window.showWarningMessage("Regenerate action is not available.");
        }
        break;
    }
  });

  panel.webview.html = /*html*/ `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;background:#1e1e1e;color:#ccc;height:100vh;display:flex;flex-direction:column;overflow:hidden}
.header{background:#252526;border-bottom:1px solid #3c3c3c;padding:12px 16px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between}
.title{font-size:14px;font-weight:700;color:#fff}
.meta{font-size:11px;color:#888;display:flex;gap:12px;align-items:center}
.badge{font-size:10px;padding:2px 8px;border-radius:12px;font-weight:700;text-transform:uppercase}
.st-ok{background:rgba(78,201,176,.15);color:#4ec9b0}
.st-err{background:rgba(244,71,71,.15);color:#f44747}
.st-run{background:rgba(0,122,204,.15);color:#4fc1ff}
.st-queue{background:rgba(220,220,170,.15);color:#dcdcaa}
.actions{display:flex;gap:6px;padding:10px 16px;border-bottom:1px solid #3c3c3c;background:#252526;flex-shrink:0;flex-wrap:wrap}
.btn{padding:6px 12px;border-radius:4px;border:1px solid transparent;font-size:11px;font-weight:600;cursor:pointer;transition:.15s}
.btn-primary{background:#00a2ad;color:#fff}.btn-primary:hover{filter:brightness(1.1)}
.btn-secondary{background:transparent;color:#ccc;border:1px solid #3c3c3c}.btn-secondary:hover{background:#3c3c3c}
.btn-ghost{background:transparent;color:#888;border:1px dashed #3c3c3c}.btn-ghost:hover{color:#ccc;border-color:#555}
.content{flex:1;display:flex;overflow:hidden}
.pane{flex:1;display:flex;flex-direction:column;overflow:hidden}
.pane-hd{padding:8px 12px;font-size:11px;font-weight:600;color:#fff;background:#252526;border-bottom:1px solid #3c3c3c}
.pane-body{flex:1;overflow:auto;background:#111}
.pane-body iframe{width:100%;height:100%;border:none;background:#fff}
.raw{padding:10px 12px;font-family:'Cascadia Code','Fira Code','Consolas',monospace;font-size:11px;line-height:1.6;white-space:pre-wrap;color:#ddd}
</style></head><body>
  <div class="header">
    <div class="title">Preview — ${escapeHtml(opts.apiName)}</div>
    <div class="meta">
      <span>${escapeHtml(createdAt)}</span>
      <span class="badge ${
        status === "SUCCEEDED" ? "st-ok"
        : status === "FAILED" ? "st-err"
        : status === "RUNNING" ? "st-run"
        : "st-queue"
      }">${escapeHtml(status)}</span>
    </div>
  </div>

  <div class="actions">
    <button class="btn btn-primary" onclick="send('generateFull')">Generate Full Source</button>
    <button class="btn btn-secondary" onclick="send('regenerate')">Regenerate Preview</button>
    <button class="btn btn-ghost" onclick="send('copy')">Copy HTML</button>
  </div>

  <div class="content">
    <div class="pane">
      <div class="pane-hd">Rendered Preview</div>
      <div class="pane-body"><iframe id="preview-frame" sandbox="allow-scripts allow-forms"></iframe></div>
    </div>
    <div class="pane" style="max-width:40%">
      <div class="pane-hd">Raw Output</div>
      <div class="pane-body"><div class="raw" id="raw"></div></div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const sanitized = ${JSON.stringify(
      sanitized.replace(/<\/(script)/gi, "<\\/$1"),
    )};
    const raw = ${JSON.stringify(raw.replace(/<\/(script)/gi, "<\\/$1"))};

    function send(type){ vscode.postMessage({ type }); }

    document.getElementById('preview-frame').srcdoc = sanitized;
    document.getElementById('raw').innerText = raw;
  </script>
</body></html>`;
}
