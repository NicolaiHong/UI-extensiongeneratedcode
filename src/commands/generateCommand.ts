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

export async function generateCmd() {
  // ── 1. Prompt source ──
  const promptSource = await vscode.window.showQuickPick(
    [
      {
        label: "✍️  Custom Prompt",
        description: "Enter your own prompt",
        value: "custom",
      },
      {
        label: "📋  Pre-built Template",
        description: "Fetch prompt templates from backend",
        value: "template",
      },
    ],
    {
      title: "UI Gen AI — Prompt Source",
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
      title: "UI Gen AI — Custom Prompt",
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
        title: "Fetching prompt templates...",
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
        title: "UI Gen AI — Select Template",
        placeHolder: "Choose a pre-built prompt template",
        matchOnDetail: true,
      },
    );
    if (!picked) {
      return;
    }

    // Allow user to optionally edit the template prompt
    prompt = await vscode.window.showInputBox({
      title: "UI Gen AI — Edit Template Prompt (optional)",
      prompt:
        "You can customize the template prompt or press Enter to use as-is",
      value: picked.value,
      ignoreFocusOut: true,
    });
  }

  if (!prompt?.trim()) {
    return;
  }

  // ── 2. Framework selection ──
  const framework = await vscode.window.showQuickPick(
    FRAMEWORKS.map((f) => ({ label: f.label, value: f.value })),
    { title: "Framework", placeHolder: "Select the frontend framework" },
  );
  if (!framework) {
    return;
  }

  // ── 3. Design System selection ──
  const designSystem = await vscode.window.showQuickPick(
    DESIGN_SYSTEMS.map((d) => ({ label: d.label, value: d.value })),
    { title: "Design System / CSS", placeHolder: "Select the design system" },
  );
  if (!designSystem) {
    return;
  }

  // ── 4. AI Provider + Model ──
  const cfg = vscode.workspace.getConfiguration("uigenai");
  const provider = await vscode.window.showQuickPick(
    [
      { label: "Gemini", value: "gemini" },
      { label: "OpenAI", value: "openai" },
    ],
    { title: "AI Provider" },
  );
  if (!provider) {
    return;
  }

  const model = await vscode.window.showInputBox({
    title: "Model",
    value:
      provider.value === "gemini"
        ? cfg.get("defaultModel", "gemini-2.0-flash")
        : "gpt-4o",
  });
  if (!model) {
    return;
  }

  // ── 5. Optional: link to an API ──
  let apiId: string | undefined;
  const linkApi = await vscode.window.showQuickPick(
    [
      { label: "No, just generate", value: "no" },
      { label: "Yes, save to an API", value: "yes" },
    ],
    { title: "Save generated code to an API?" },
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
          { title: "Select API" },
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

  // ── 6. Build final prompt with framework + design system ──
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
      title: "🤖 Generating code...",
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

  if (!result?.success || !result.changes.length) {
    if (result?.changes?.length === 0) {
      vscode.window.showWarningMessage(
        "AI returned no code. Try a more specific prompt.",
      );
    }
    return;
  }

  const previewLabel = `${prompt.trim()}  [${framework.label} · ${designSystem.label}]`;
  showPreview(result, previewLabel);
}

function showPreview(result: GenerateResult, prompt: string) {
  const panel = vscode.window.createWebviewPanel(
    "uigenai-preview",
    "⚡ Generated Code",
    vscode.ViewColumn.One,
    { enableScripts: true },
  );

  panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.type) {
      case "applyAll":
        await applyFiles(result.changes);
        panel.webview.postMessage({ type: "applied" });
        break;
      case "applyFile": {
        const file = result.changes[msg.i];
        if (file) {
          await applyFiles([file]);
        }
        break;
      }
      case "copy": {
        const file = result.changes[msg.i];
        if (file) {
          await vscode.env.clipboard.writeText(file.codeContent);
          vscode.window.showInformationMessage("Copied!");
        }
        break;
      }
    }
  });

  const files = JSON.stringify(
    result.changes.map((c) => ({
      name: c.fileName,
      content: c.codeContent,
      lang: path.extname(c.fileName).replace(".", "").toUpperCase() || "FILE",
      lines: c.codeContent.split("\n").length,
    })),
  );

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
<div class="done" id="done">✅ Files applied to workspace!</div>
<div class="hd"><div class="hd-top"><h2>⚡ Generated Code<span class="badge" id="cnt"></span></h2>
<button class="btn bp" onclick="applyAll()" id="ab">📁 Apply All</button></div>
<div class="prompt">💬 ${escapeHtml(prompt)}</div></div>
${result.summary ? `<div class="sm">${escapeHtml(result.summary)}</div>` : ""}
<div class="main-tabs">
<button class="main-tab active" onclick="switchTab('code')">📄 Code</button>
<button class="main-tab" onclick="switchTab('preview')">👁️ Live Preview</button>
</div>
<div class="tab-panel active" id="tab-code">
<div class="fl" id="fl"></div>
</div>
<div class="tab-panel" id="tab-preview">
<div class="preview-container">
<div class="size-bar">
<label>Viewport:</label>
<button class="btn bs" onclick="setSize(375,667)">📱 Mobile</button>
<button class="btn bs" onclick="setSize(768,600)">📟 Tablet</button>
<button class="btn bs active-view" onclick="setSize('100%',500)">🖥️ Desktop</button>
</div>
<div class="preview-toolbar" id="preview-toolbar"></div>
<div class="preview-frame" id="preview-frame">
<div class="preview-empty" id="preview-empty">Select a component file above to preview</div>
<iframe id="preview-iframe" style="display:none" sandbox="allow-scripts"></iframe>
</div>
</div>
</div>
<script>
const vscode=acquireVsCodeApi(),files=${files};
document.getElementById('cnt').textContent=files.length+' files';

/* ---- Tab switching ---- */
function switchTab(t){
  document.querySelectorAll('.main-tab').forEach((b,i)=>b.classList.toggle('active',i===(t==='code'?0:1)));
  document.querySelectorAll('.tab-panel').forEach((p,i)=>p.classList.toggle('active',i===(t==='code'?0:1)));
  if(t==='preview') buildPreviewToolbar();
}

/* ---- Code tab ---- */
const fl=document.getElementById('fl');
files.forEach((f,i)=>{const d=document.createElement('div');d.className='fi';d.innerHTML=\`<div class="fh" onclick="tog(\${i})"><div class="fn">📄 \${esc(f.name)}</div><div style="display:flex;align-items:center;gap:10px"><div class="fm">\${f.lang} · \${f.lines} lines</div><div class="fa"><button class="btn bs" style="padding:3px 8px;font-size:10px" onclick="event.stopPropagation();cp(\${i})">📋</button><button class="btn bs" style="padding:3px 8px;font-size:10px" onclick="event.stopPropagation();af(\${i})">📁</button></div></div></div><div class="cb" id="c\${i}"><pre>\${esc(f.content)}</pre></div>\`;fl.appendChild(d)});

function tog(i){document.getElementById('c'+i).classList.toggle('open')}
function applyAll(){vscode.postMessage({type:'applyAll'})}
function af(i){vscode.postMessage({type:'applyFile',i})}
function cp(i){vscode.postMessage({type:'copy',i})}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

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
    tb.innerHTML='<button class="btn bs active-view" onclick="renderAll()">🔄 Render All Files</button>';
    renderAll();
    return;
  }
  pFiles.forEach((f,idx)=>{
    const b=document.createElement('button');
    b.className='btn bs';
    b.textContent='👁️ '+f.name;
    b.onclick=()=>{
      tb.querySelectorAll('.btn').forEach(x=>x.classList.remove('active-view'));
      b.classList.add('active-view');
      renderFile(files.indexOf(f));
    };
    tb.appendChild(b);
  });
  // Also add "Render All" button
  const ba=document.createElement('button');
  ba.className='btn bs';ba.textContent='🔄 All Combined';
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

window.addEventListener('message',e=>{if(e.data.type==='applied'){document.getElementById('done').classList.add('show');const b=document.getElementById('ab');b.disabled=true;b.textContent='✅ Applied!'}})
</script></body></html>`;
}

async function applyFiles(changes: GenerateChange[]) {
  const wf = vscode.workspace.workspaceFolders;
  let base: vscode.Uri;
  if (!wf?.length) {
    const f = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      title: "Select target folder",
    });
    if (!f?.length) {
      return;
    }
    base = f[0];
  } else {
    base =
      wf.length === 1
        ? wf[0].uri
        : (await vscode.window.showWorkspaceFolderPick())?.uri || wf[0].uri;
  }

  let n = 0;
  for (const c of changes) {
    if (!c) {
      continue;
    }
    const p = c.fileName.replace(/^\/+/, "");
    const uri = vscode.Uri.joinPath(base, p);
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
    } catch {}
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(c.codeContent, "utf-8"),
    );
    n++;
  }
  vscode.window.showInformationMessage(`✅ ${n} file(s) written!`);
  if (changes[0]) {
    try {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.joinPath(base, changes[0].fileName.replace(/^\/+/, "")),
      );
      await vscode.window.showTextDocument(doc);
    } catch {}
  }
}
