import * as vscode from "vscode";
import { generatedCodesApi, GeneratedCode } from "../api/generatedCodes.api";

export async function viewGeneratedCodeCmd(apiId: string, codeId: string) {
  try {
    const code = await generatedCodesApi.getById(apiId, codeId);

    const previewExts = [".jsx", ".tsx", ".html", ".htm", ".vue", ".svelte"];
    const isPreviewable = previewExts.some((e) =>
      code.file_path.toLowerCase().endsWith(e),
    );

    if (isPreviewable) {
      const pick = await vscode.window.showQuickPick(
        [
          {
            label: "👁️ Live Preview",
            description: "Render UI in a panel",
            value: "preview",
          },
          {
            label: "📄 View Code",
            description: "Open as source code",
            value: "code",
          },
        ],
        { title: code.file_path },
      );
      if (pick?.value === "preview") {
        showCodePreviewPanel(code);
        return;
      }
      if (!pick) {
        return;
      }
    }

    const doc = await vscode.workspace.openTextDocument({
      content: code.content,
      language: code.language || "typescript",
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (e: any) {
    vscode.window.showErrorMessage(
      `Failed: ${e.response?.data?.error?.message || e.message}`,
    );
  }
}

function showCodePreviewPanel(code: GeneratedCode) {
  const panel = vscode.window.createWebviewPanel(
    "uigenai-code-preview",
    `👁️ ${code.file_path}`,
    vscode.ViewColumn.One,
    { enableScripts: true },
  );

  let htmlContent = code.content;
  const ext = code.file_path.toLowerCase();
  if (
    ext.endsWith(".jsx") ||
    ext.endsWith(".tsx") ||
    ext.endsWith(".vue") ||
    ext.endsWith(".svelte")
  ) {
    htmlContent = jsxToHtml(code.content);
  }

  const isFullHtml = ext.endsWith(".html") || ext.endsWith(".htm");

  panel.webview.html = /*html*/ `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#121416;color:#fff;padding:0}
.toolbar{padding:10px 16px;background:#1c1f21;border-bottom:1px solid rgba(255,255,255,.08);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.toolbar .title{font-size:13px;font-weight:700;margin-right:auto}
.btn{padding:5px 10px;border-radius:6px;border:none;font-size:11px;font-weight:600;cursor:pointer;color:rgba(255,255,255,.8);background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);transition:.15s}
.btn:hover{background:rgba(255,255,255,.1)}.btn.active{background:#00a2ad;color:#fff;border-color:#00a2ad}
.frame{width:100%;background:#fff;display:flex;justify-content:center;min-height:calc(100vh - 46px)}
.frame iframe{border:none;height:calc(100vh - 46px);background:#fff}
</style></head><body>
<div class="toolbar">
<div class="title">👁️ ${code.file_path.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>
<button class="btn" onclick="setSize(375)">📱 Mobile</button>
<button class="btn" onclick="setSize(768)">📟 Tablet</button>
<button class="btn active" onclick="setSize('100%')">🖥️ Desktop</button>
</div>
<div class="frame"><iframe id="pf" style="width:100%" sandbox="allow-scripts"
  srcdoc="${
    isFullHtml
      ? code.content.replace(/"/g, "&quot;")
      : `<!DOCTYPE html><html><head><meta charset=&quot;UTF-8&quot;><meta name=&quot;viewport&quot; content=&quot;width=device-width,initial-scale=1&quot;><link rel=&quot;stylesheet&quot; href=&quot;https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css&quot;><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;padding:16px;background:#fff;color:#1a1a2e}</style></head><body>${htmlContent.replace(/"/g, "&quot;")}</body></html>`
  }"></iframe></div>
<script>
function setSize(w){const f=document.getElementById('pf');f.style.width=typeof w==='number'?w+'px':w;
document.querySelectorAll('.btn').forEach(b=>b.classList.remove('active'));event.target.classList.add('active');}
</script></body></html>`;
}

function jsxToHtml(code: string): string {
  let c = code
    .replace(/^import\s.*$/gm, "")
    .replace(/^export\s+(default\s+)?/gm, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/interface\s+\w+\s*\{[^}]*\}/gs, "")
    .replace(/type\s+\w+\s*=[^;]+;/g, "");

  const fnMatch = c.match(
    /(?:function\s+\w+|const\s+\w+\s*=\s*(?:\([^)]*\)|\w+)\s*(?:=>|:\s*\w+\s*=>))\s*\{?[\s\S]*?return\s*\(([\s\S]*?)\);?\s*\}?\s*;?\s*$/m,
  );
  let jsx = fnMatch ? fnMatch[1] : c;

  jsx = jsx
    .replace(/className=/g, "class=")
    .replace(/htmlFor=/g, "for=")
    .replace(/\{[^}]*\}/g, "")
    .replace(/on[A-Z]\w*=[^\s>]*/g, "")
    .replace(/<>|<\/>/g, "")
    .trim();
  return jsx;
}

export async function applyGeneratedCodeCmd(apiId: string, codeId: string) {
  try {
    const code = await generatedCodesApi.getById(apiId, codeId);
    const wf = vscode.workspace.workspaceFolders;
    if (!wf?.length) {
      vscode.window.showErrorMessage("Open a workspace first");
      return;
    }

    const uri = vscode.Uri.joinPath(
      wf[0].uri,
      code.file_path.replace(/^\/+/, ""),
    );
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
    } catch {}
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(code.content, "utf-8"),
    );
    vscode.window.showInformationMessage(`Applied: ${code.file_path}`);

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  } catch (e: any) {
    vscode.window.showErrorMessage(
      `Failed: ${e.response?.data?.error?.message || e.message}`,
    );
  }
}

export async function deleteGeneratedCodeCmd(apiId: string, codeId: string) {
  const c = await vscode.window.showWarningMessage(
    "Delete this generated code?",
    { modal: true },
    "Delete",
  );
  if (c !== "Delete") {
    return;
  }
  try {
    await generatedCodesApi.delete(apiId, codeId);
    vscode.window.showInformationMessage("Code deleted.");
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: any) {
    vscode.window.showErrorMessage(
      `Failed: ${e.response?.data?.error?.message || e.message}`,
    );
  }
}
