import * as vscode from "vscode";
import * as path from "path";
import { generateApi, GenerateResult, GenerateChange } from "../api/generate.api";
import { apisApi } from "../api/apis.api";

export async function generateCmd() {
  const editor = vscode.window.activeTextEditor;
  const selected = editor?.document.getText(editor.selection);

  const prompt = await vscode.window.showInputBox({
    title: "UI Gen AI — Generate Code",
    prompt: "Describe the UI you want to generate",
    placeHolder: "e.g. Create a user management dashboard with table, search, and CRUD",
    value: selected || "",
    ignoreFocusOut: true,
  });
  if (!prompt?.trim()) { return; }

  const cfg = vscode.workspace.getConfiguration("uigenai");
  const provider = await vscode.window.showQuickPick(
    [{ label: "Gemini", value: "gemini" }, { label: "OpenAI", value: "openai" }],
    { title: "AI Provider" }
  );
  if (!provider) { return; }

  const model = await vscode.window.showInputBox({
    title: "Model", value: provider.value === "gemini" ? cfg.get("defaultModel", "gemini-2.0-flash") : "gpt-4o",
  });
  if (!model) { return; }

  // Optional: link to an API
  let apiId: string | undefined;
  const linkApi = await vscode.window.showQuickPick(
    [{ label: "No, just generate", value: "no" }, { label: "Yes, save to an API", value: "yes" }],
    { title: "Save generated code to an API?" }
  );
  if (linkApi?.value === "yes") {
    try {
      const apis = await apisApi.list();
      if (apis.length > 0) {
        const pick = await vscode.window.showQuickPick(
          apis.map(a => ({ label: a.name, description: a.base_url || "", value: a.id })),
          { title: "Select API" }
        );
        apiId = pick?.value;
      } else {
        vscode.window.showWarningMessage("No APIs found. Generating without saving.");
      }
    } catch { /* skip if not logged in */ }
  }

  let result: GenerateResult | undefined;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "🤖 Generating code..." },
    async () => {
      try {
        result = await generateApi.generate({ prompt: prompt.trim(), provider: provider.value, model, apiId });
      } catch (e: any) {
        vscode.window.showErrorMessage(`Generation failed: ${e.response?.data?.error?.message || e.message}`);
      }
    }
  );

  if (!result?.success || !result.changes.length) {
    if (result?.changes?.length === 0) { vscode.window.showWarningMessage("AI returned no code. Try a more specific prompt."); }
    return;
  }

  showPreview(result, prompt.trim());
}

function showPreview(result: GenerateResult, prompt: string) {
  const panel = vscode.window.createWebviewPanel("uigenai-preview", "⚡ Generated Code", vscode.ViewColumn.One, { enableScripts: true });

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === "applyAll") { await applyFiles(result.changes); panel.webview.postMessage({ type: "applied" }); }
    if (msg.type === "applyFile") { await applyFiles([result.changes[msg.i]]); }
    if (msg.type === "copy") { await vscode.env.clipboard.writeText(result.changes[msg.i].codeContent); vscode.window.showInformationMessage("Copied!"); }
  });

  const files = JSON.stringify(result.changes.map(c => ({
    name: c.fileName, content: c.codeContent,
    lang: path.extname(c.fileName).replace(".", "").toUpperCase() || "FILE",
    lines: c.codeContent.split("\n").length,
  })));
  const esc = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  panel.webview.html = /*html*/`<!DOCTYPE html><html><head><meta charset="UTF-8">
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
.fl{padding:12px 20px}.fi{border:1px solid rgba(255,255,255,.08);border-radius:10px;margin-bottom:10px;overflow:hidden;background:#1c1f21}
.fh{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:rgba(255,255,255,.03);border-bottom:1px solid rgba(255,255,255,.06);cursor:pointer}
.fh:hover{background:rgba(255,255,255,.05)}.fn{font-size:12px;font-weight:600}
.fm{font-size:10px;color:rgba(255,255,255,.35)}.fa{display:flex;gap:4px}
.cb{max-height:350px;overflow:auto;display:none}.cb.open{display:block}
.cb pre{margin:0;padding:14px;font-family:'Cascadia Code','Fira Code',monospace;font-size:11px;line-height:1.5;color:rgba(255,255,255,.85);white-space:pre;overflow-x:auto}
.done{display:none;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.2);color:#4ade80;padding:10px 20px;text-align:center;font-weight:600;font-size:13px}.done.show{display:block}
</style></head><body>
<div class="done" id="done">✅ Files applied to workspace!</div>
<div class="hd"><div class="hd-top"><h2>⚡ Generated Code<span class="badge" id="cnt"></span></h2>
<button class="btn bp" onclick="applyAll()" id="ab">📁 Apply All</button></div>
<div class="prompt">💬 ${esc(prompt)}</div></div>
${result.summary ? `<div class="sm">${esc(result.summary)}</div>` : ""}
<div class="fl" id="fl"></div>
<script>
const vscode=acquireVsCodeApi(),files=${files};
document.getElementById('cnt').textContent=files.length+' files';
const fl=document.getElementById('fl');
files.forEach((f,i)=>{const d=document.createElement('div');d.className='fi';d.innerHTML=\`<div class="fh" onclick="tog(\${i})"><div class="fn">📄 \${esc(f.name)}</div><div style="display:flex;align-items:center;gap:10px"><div class="fm">\${f.lang} · \${f.lines} lines</div><div class="fa"><button class="btn bs" style="padding:3px 8px;font-size:10px" onclick="event.stopPropagation();cp(\${i})">📋</button><button class="btn bs" style="padding:3px 8px;font-size:10px" onclick="event.stopPropagation();af(\${i})">📁</button></div></div></div><div class="cb" id="c\${i}"><pre>\${esc(f.content)}</pre></div>\`;fl.appendChild(d)});
function tog(i){document.getElementById('c'+i).classList.toggle('open')}
function applyAll(){vscode.postMessage({type:'applyAll'})}
function af(i){vscode.postMessage({type:'applyFile',i})}
function cp(i){vscode.postMessage({type:'copy',i})}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
window.addEventListener('message',e=>{if(e.data.type==='applied'){document.getElementById('done').classList.add('show');const b=document.getElementById('ab');b.disabled=true;b.textContent='✅ Applied!'}})
</script></body></html>`;
}

async function applyFiles(changes: GenerateChange[]) {
  const wf = vscode.workspace.workspaceFolders;
  let base: vscode.Uri;
  if (!wf?.length) {
    const f = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, title: "Select target folder" });
    if (!f?.length) { return; }
    base = f[0];
  } else {
    base = wf.length === 1 ? wf[0].uri : (await vscode.window.showWorkspaceFolderPick())?.uri || wf[0].uri;
  }

  let n = 0;
  for (const c of changes) {
    if (!c) { continue; }
    const p = c.fileName.replace(/^\/+/, "");
    const uri = vscode.Uri.joinPath(base, p);
    try { await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, "..")); } catch {}
    await vscode.workspace.fs.writeFile(uri, Buffer.from(c.codeContent, "utf-8"));
    n++;
  }
  vscode.window.showInformationMessage(`✅ ${n} file(s) written!`);
  if (changes[0]) {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(base, changes[0].fileName.replace(/^\/+/, "")));
      await vscode.window.showTextDocument(doc);
    } catch {}
  }
}
