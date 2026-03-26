import * as vscode from "vscode";
import { AuthManager } from "../auth/authManager";
import { getServerUrl } from "../api/client";
import { projectsApi, Project } from "../api/projects.api";
import { documentsApi, DocumentType } from "../api/documents.api";
import { sessionsApi, Session } from "../api/sessions.api";
import { apisApi, Api } from "../api/apis.api";
import { apiConfigsApi, ApiConfig } from "../api/apiConfigs.api";
import { uiSchemasApi, UiSchema } from "../api/uiSchemas.api";
import { generatedCodesApi, GeneratedCode } from "../api/generatedCodes.api";
import { deploymentsApi, Deployment } from "../api/deployments.api";
import { extractApiError } from "../utils/errors";
import { escapeHtml } from "../utils/html";
import { showSessionReviewPanel } from "../utils/sessionReviewPanel";

export class DashboardProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "uigenai.dashboard";
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _auth: AuthManager,
  ) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this._view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((msg) => this._handleMessage(msg));
    this._render();
  }

  refresh() {
    this._render();
  }

  /* ------------------------------------------------------------------ */
  /*  Message Handler                                                    */
  /* ------------------------------------------------------------------ */
  private async _handleMessage(msg: any) {
    try {
      switch (msg.cmd) {
        /* ---- Auth ---- */
        case "login":
          vscode.commands.executeCommand("uigenai.login");
          break;
        case "logout":
          vscode.commands.executeCommand("uigenai.logout");
          break;
        case "oauthGoogle":
          vscode.env.openExternal(
            vscode.Uri.parse(`${getServerUrl()}/auth/google`),
          );
          break;
        case "oauthGithub":
          vscode.env.openExternal(
            vscode.Uri.parse(`${getServerUrl()}/auth/github`),
          );
          break;

        /* ---- Projects ---- */
        case "loadProjects":
          this._post("projects", await projectsApi.list());
          break;
        case "createProject":
          vscode.commands.executeCommand("uigenai.createProject");
          break;
        case "editProject":
          {
            const { editProjectCmd } =
              await import("../commands/projectCommands");
            await editProjectCmd(msg.id);
          }
          break;
        case "deleteProject":
          {
            const { deleteProjectCmd } =
              await import("../commands/projectCommands");
            await deleteProjectCmd(msg.id, msg.name);
          }
          break;

        /* ---- Documents ---- */
        case "loadDocuments":
          this._post("documents", {
            projectId: msg.projectId,
            docs: await documentsApi.list(msg.projectId),
          });
          break;
        case "uploadDocument":
          vscode.commands.executeCommand(
            "uigenai.uploadDocument",
            msg.projectId,
          );
          break;
        case "viewDocument": {
          const doc = await documentsApi.getByType(
            msg.projectId,
            msg.type as DocumentType,
          );
          const td = await vscode.workspace.openTextDocument({
            content: doc.content,
            language: "json",
          });
          await vscode.window.showTextDocument(td, { preview: true });
          break;
        }
        case "deleteDocument":
          if (await confirmDelete("this document")) {
            await documentsApi.delete(msg.projectId, msg.type as DocumentType);
            vscode.window.showInformationMessage("Document deleted.");
            this._post("documentsDeleted", {
              projectId: msg.projectId,
              type: msg.type,
            });
            vscode.commands.executeCommand("uigenai.refreshSidebar");
          }
          break;

        /* ---- Sessions ---- */
        case "loadSessions":
          this._post("sessions", {
            projectId: msg.projectId,
            sessions: await sessionsApi.list(msg.projectId),
          });
          break;
        case "runSession":
          vscode.commands.executeCommand("uigenai.runSession", msg.projectId);
          break;
        case "viewSession": {
          await showSessionReviewPanel(msg.projectId, msg.id);
          break;
        }
        case "deleteSession": {
          const confirmDel = await vscode.window.showWarningMessage(
            "Delete this session? This cannot be undone.",
            { modal: true },
            "Delete",
          );
          if (confirmDel === "Delete") {
            await sessionsApi.delete(msg.projectId, msg.id);
            vscode.window.showInformationMessage("Session deleted.");
            vscode.commands.executeCommand("uigenai.refreshSidebar");
          }
          break;
        }

        /* ---- APIs ---- */
        case "loadApis":
          this._post("apis", await apisApi.list());
          break;
        case "createApi":
          vscode.commands.executeCommand("uigenai.createApi");
          break;
        case "editApi":
          {
            const { editApiCmd } = await import("../commands/apiCommands");
            await editApiCmd(msg.id);
          }
          break;
        case "deleteApi":
          {
            const { deleteApiCmd } = await import("../commands/apiCommands");
            await deleteApiCmd(msg.id, msg.name);
          }
          break;

        /* ---- ApiConfigs ---- */
        case "loadConfigs":
          this._post("configs", {
            apiId: msg.apiId,
            configs: await apiConfigsApi.list(msg.apiId),
          });
          break;
        case "createConfig":
          {
            const { createApiConfigCmd } =
              await import("../commands/apiConfigCommands");
            await createApiConfigCmd(msg.apiId);
          }
          break;
        case "editConfig":
          {
            const { editApiConfigCmd } =
              await import("../commands/apiConfigCommands");
            await editApiConfigCmd(msg.apiId, msg.id);
          }
          break;
        case "deleteConfig":
          {
            const { deleteApiConfigCmd } =
              await import("../commands/apiConfigCommands");
            await deleteApiConfigCmd(msg.apiId, msg.id);
          }
          break;

        /* ---- UI Schemas ---- */
        case "loadSchemas":
          this._post("schemas", {
            apiId: msg.apiId,
            schemas: await uiSchemasApi.list(msg.apiId),
          });
          break;
        case "createSchema":
          {
            const { createUiSchemaCmd } =
              await import("../commands/uiSchemaCommands");
            await createUiSchemaCmd(msg.apiId);
          }
          break;
        case "editSchema":
          {
            const { editUiSchemaCmd } =
              await import("../commands/uiSchemaCommands");
            await editUiSchemaCmd(msg.apiId, msg.id);
          }
          break;
        case "deleteSchema":
          {
            const { deleteUiSchemaCmd } =
              await import("../commands/uiSchemaCommands");
            await deleteUiSchemaCmd(msg.apiId, msg.id);
          }
          break;

        /* ---- Generated Codes ---- */
        case "loadCodes":
          this._post("codes", {
            apiId: msg.apiId,
            codes: await generatedCodesApi.list(msg.apiId),
          });
          break;
        case "viewCode":
          {
            const { viewGeneratedCodeCmd } =
              await import("../commands/generatedCodeCommands");
            await viewGeneratedCodeCmd(msg.apiId, msg.id);
          }
          break;
        case "applyCode":
          {
            const { applyGeneratedCodeCmd } =
              await import("../commands/generatedCodeCommands");
            await applyGeneratedCodeCmd(msg.apiId, msg.id);
          }
          break;
        case "deleteCode":
          {
            const { deleteGeneratedCodeCmd } =
              await import("../commands/generatedCodeCommands");
            await deleteGeneratedCodeCmd(msg.apiId, msg.id);
          }
          break;

        /* ---- Deployments ---- */
        case "loadDeployments":
          this._post("deployments", {
            apiId: msg.apiId,
            deployments: await deploymentsApi.list(msg.apiId),
          });
          break;
        case "createDeployment":
          vscode.commands.executeCommand("uigenai.createDeployment");
          break;
        case "updateDeployment":
          {
            const { updateDeploymentStatusCmd } =
              await import("../commands/deploymentCommands");
            await updateDeploymentStatusCmd(msg.apiId, msg.id);
          }
          break;
        case "startDeployment":
          {
            const { startDeploymentCmd } =
              await import("../commands/deploymentCommands");
            await startDeploymentCmd(msg.apiId, msg.id);
          }
          break;
        case "deleteDeployment":
          if (await confirmDelete("this deployment")) {
            await deploymentsApi.delete(msg.apiId, msg.id);
            vscode.window.showInformationMessage("Deployment deleted.");
            vscode.commands.executeCommand("uigenai.refreshSidebar");
          }
          break;

        /* ---- Generate ---- */
        case "generate":
          vscode.commands.executeCommand("uigenai.generate");
          break;
        case "directGenerate":
          vscode.commands.executeCommand("uigenai.directGenerate");
          break;
        case "advancedGenerate":
          vscode.commands.executeCommand("uigenai.advancedGenerate");
          break;
      }
    } catch (e: unknown) {
      vscode.window.showErrorMessage(extractApiError(e));
    }
  }

  private _post(type: string, data: any) {
    this._view?.webview.postMessage({ type, data });
  }

  /* ------------------------------------------------------------------ */
  /*  Render HTML                                                        */
  /* ------------------------------------------------------------------ */
  private _render() {
    if (!this._view) {
      return;
    }
    const user = this._auth.user;
    this._view.webview.html = this._getHtml(user);
  }

  private _getHtml(
    user: {
      id: string;
      email: string | null;
      displayName: string | null;
      avatarUrl: string | null;
    } | null,
  ): string {
    return /*html*/ `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#1e1e1e;--card:#252526;--border:#3c3c3c;--accent:#00a2ad;--accent2:#007acc;--text:#ccc;--text2:#888;--err:#f44747;--ok:#4ec9b0;--warn:#dcdcaa}
body{font-family:var(--vscode-font-family,'Segoe UI',sans-serif);background:var(--bg);color:var(--text);font-size:12px;padding:0}
button{font-family:inherit;font-size:11px;cursor:pointer;border:none;border-radius:4px;padding:4px 8px;transition:.15s}
.btn-p{background:var(--accent);color:#fff}.btn-p:hover{filter:brightness(1.2)}
.btn-s{background:transparent;color:var(--text2);border:1px solid var(--border)}.btn-s:hover{background:var(--border)}
.btn-d{background:transparent;color:var(--err)}.btn-d:hover{background:rgba(244,71,71,.15)}
.btn-icon{background:transparent;color:var(--text2);padding:2px 4px;font-size:13px}.btn-icon:hover{color:var(--text)}

/* Auth bar */
.auth{padding:10px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:6px}
.auth-user{display:flex;align-items:center;gap:6px;overflow:hidden}
.auth-user span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;font-size:11px}
.avatar{width:22px;height:22px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0}

/* Sections */
.section{border-bottom:1px solid var(--border)}
.sec-hd{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;cursor:pointer;user-select:none}
.sec-hd:hover{background:rgba(255,255,255,.04)}
.sec-hd h3{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text2)}
.sec-hd .arrow{transition:transform .2s;font-size:10px;color:var(--text2)}
.sec-hd .arrow.open{transform:rotate(90deg)}
.sec-body{display:none;padding:0 10px 8px}
.sec-body.open{display:block}

/* Items */
.item{display:flex;align-items:center;justify-content:space-between;padding:4px 6px;border-radius:4px;margin:1px 0}
.item:hover{background:rgba(255,255,255,.05)}
.item-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;font-size:11px}
.item-actions{display:flex;gap:2px;flex-shrink:0}
.badge{font-size:9px;padding:1px 5px;border-radius:8px;font-weight:600;margin-left:4px}
.badge-ok{background:rgba(78,201,176,.15);color:var(--ok)}
.badge-warn{background:rgba(220,220,170,.15);color:var(--warn)}
.badge-err{background:rgba(244,71,71,.15);color:var(--err)}
.badge-info{background:rgba(0,122,204,.15);color:var(--accent2)}

/* Sub-sections (nested under APIs) */
.sub{padding-left:10px;margin-top:4px}
.sub-hd{font-size:10px;font-weight:600;color:var(--text2);padding:4px 0;display:flex;align-items:center;justify-content:space-between;cursor:pointer}
.sub-hd:hover{color:var(--text)}
.sub-body{display:none;padding-left:4px}.sub-body.open{display:block}

/* Generate bar */
.gen{padding:10px;border-bottom:1px solid var(--border)}
.gen button{width:100%;padding:8px;font-size:12px;font-weight:700}

/* Empty / loading */
.empty{color:var(--text2);font-size:11px;font-style:italic;padding:4px 6px}
.spin{display:inline-block;animation:sp .8s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
</style></head><body>

<!-- Auth Bar -->
<div class="auth">
${
  user
    ? `
  <div class="auth-user">
    <div class="avatar">${(user.displayName || user.email || "U")[0].toUpperCase()}</div>
    <span>${escapeHtml(user.displayName || user.email || "User")}</span>
  </div>
  <button class="btn-s" onclick="send('logout')">Logout</button>
`
    : `
  <span style="color:var(--text2)">Not logged in</span>
  <div style="display:flex;gap:4px;flex-wrap:wrap">
    <button class="btn-p" onclick="send('login')">Login</button>
    <button class="btn-s" onclick="send('oauthGoogle')" title="Sign in with Google">Google</button>
    <button class="btn-s" onclick="send('oauthGithub')" title="Sign in with GitHub">GitHub</button>
  </div>
`
}
</div>

<!-- Generate Section -->
<div class="section" id="sec-generate">
  <div class="sec-hd" onclick="toggleSec('generate')">
    <h3>Generate</h3>
    <span class="arrow open" id="arrow-generate">&#9654;</span>
  </div>
  <div class="sec-body open" id="body-generate">
    ${
      user
        ? `
    <div style="padding:2px 0 6px">
      <button class="btn-p" style="width:100%;padding:7px 8px;font-size:11px;font-weight:600;margin-bottom:4px;text-align:left"
        onclick="send('directGenerate')">From OpenAPI / Swagger</button>
      <div style="color:var(--text2);font-size:10px;padding:0 4px 8px">Upload a Swagger file, derive schemas, and generate UI into your project.</div>

      <button class="btn-p" style="width:100%;padding:7px 8px;font-size:11px;font-weight:600;margin-bottom:4px;text-align:left;background:var(--accent2)"
        onclick="send('advancedGenerate')">From Source Folder</button>
      <div style="color:var(--text2);font-size:10px;padding:0 4px 8px">Scan backend source code to infer API schemas, then generate UI.</div>
    </div>
    `
        : ""
    }
    <button class="btn-s" style="width:100%;padding:6px 8px;font-size:11px;text-align:left"
      onclick="send('generate')">Quick Generate (Prompt Only)</button>
    <div style="color:var(--text2);font-size:10px;padding:2px 4px 4px">Generate UI from a text prompt without a project.</div>
  </div>
</div>

${
  user
    ? `
<!-- Projects Section -->
<div class="section" id="sec-projects">
  <div class="sec-hd" onclick="toggleSec('projects')">
    <h3>Projects</h3>
    <div style="display:flex;align-items:center;gap:4px">
      <button class="btn-icon" title="New Project" onclick="event.stopPropagation();send('createProject')">＋</button>
      <span class="arrow" id="arrow-projects">▶</span>
    </div>
  </div>
  <div class="sec-body" id="body-projects">
    <div class="empty" id="projects-loading"><span class="spin">⟳</span> Loading...</div>
    <div id="projects-list"></div>
  </div>
</div>

<!-- APIs Section -->
<div class="section" id="sec-apis">
  <div class="sec-hd" onclick="toggleSec('apis')">
    <h3>APIs</h3>
    <div style="display:flex;align-items:center;gap:4px">
      <button class="btn-icon" title="New API" onclick="event.stopPropagation();send('createApi')">＋</button>
      <span class="arrow" id="arrow-apis">▶</span>
    </div>
  </div>
  <div class="sec-body" id="body-apis">
    <div class="empty" id="apis-loading"><span class="spin">⟳</span> Loading...</div>
    <div id="apis-list"></div>
  </div>
</div>
`
    : `<div style="padding:16px 10px;text-align:center;color:var(--text2)">Login to view your projects and APIs.</div>`
}

<script>
const vscode = acquireVsCodeApi();
function send(cmd, extra) { vscode.postMessage(Object.assign({ cmd }, extra || {})); }
function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

/* ---- Section toggle ---- */
function toggleSec(id) {
  const b = document.getElementById('body-' + id);
  const a = document.getElementById('arrow-' + id);
  const open = b.classList.toggle('open');
  a.classList.toggle('open', open);
  if (open) {
    if (id === 'projects') send('loadProjects');
    if (id === 'apis') send('loadApis');
  }
}

/* ---- Status badge helper ---- */
function statusBadge(s) {
  if (!s) return '';
  const map = { ACTIVE:'ok', DEPLOYED:'ok', SUCCEEDED:'ok', INACTIVE:'warn', PENDING:'warn', QUEUED:'warn', READY_TO_DEPLOY:'info', DEPLOYING:'info', IN_PROGRESS:'info', RUNNING:'info', DEPRECATED:'err', FAILED:'err', DEPLOY_FAILED:'err', ROLLED_BACK:'err' };
  return '<span class="badge badge-' + (map[s] || 'info') + '">' + s + '</span>';
}

/* ---- Render Projects ---- */
function renderProjects(projects) {
  document.getElementById('projects-loading').style.display = 'none';
  const c = document.getElementById('projects-list');
  if (!projects.length) { c.innerHTML = '<div class="empty">No projects yet.</div>'; return; }
  c.innerHTML = projects.map(p => \`
    <div class="item">
      <div class="item-name" onclick="toggleProjectSub('\${p.id}')" title="\${esc(p.description || '')}">\${esc(p.name)}</div>
      <div class="item-actions">
        <button class="btn-icon" title="Edit" onclick="send('editProject',{id:'\${p.id}'})">✏️</button>
        <button class="btn-icon" title="Delete" onclick="send('deleteProject',{id:'\${p.id}',name:'\${esc(p.name)}'})">🗑️</button>
      </div>
    </div>
    <div class="sub" id="psub-\${p.id}" style="display:none">
      <div class="sub-hd" onclick="toggleProjectSubSec('\${p.id}','docs')">
        Documents <button class="btn-icon" onclick="event.stopPropagation();send('uploadDocument',{projectId:'\${p.id}'})">＋</button>
      </div>
      <div class="sub-body" id="pdocs-\${p.id}"></div>
      <div class="sub-hd" onclick="toggleProjectSubSec('\${p.id}','sessions')">
        Sessions <button class="btn-icon" onclick="event.stopPropagation();send('runSession',{projectId:'\${p.id}'})">▶</button>
      </div>
      <div class="sub-body" id="psess-\${p.id}"></div>
    </div>
  \`).join('');
}

function toggleProjectSub(pid) {
  const el = document.getElementById('psub-' + pid);
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
function toggleProjectSubSec(pid, type) {
  const el = document.getElementById(type === 'docs' ? 'pdocs-' + pid : 'psess-' + pid);
  const open = el.classList.toggle('open');
  if (open) {
    el.innerHTML = '<div class="empty"><span class="spin">⟳</span> Loading...</div>';
    if (type === 'docs') send('loadDocuments', { projectId: pid });
    else send('loadSessions', { projectId: pid });
  }
}

function renderDocuments(projectId, docs) {
  const c = document.getElementById('pdocs-' + projectId);
  if (!c) return;
  if (!docs.length) { c.innerHTML = '<div class="empty">No documents.</div>'; return; }
  c.innerHTML = docs.map(d => \`
    <div class="item">
      <div class="item-name" onclick="send('viewDocument',{projectId:'\${projectId}',type:'\${d.type}'})">\${esc(d.name)} <span class="badge badge-info">\${d.type}</span></div>
      <div class="item-actions">
        <button class="btn-icon" title="Delete" onclick="send('deleteDocument',{projectId:'\${projectId}',type:'\${d.type}'})">🗑️</button>
      </div>
    </div>
  \`).join('');
}

function renderSessions(projectId, sessions) {
  const c = document.getElementById('psess-' + projectId);
  if (!c) return;
  if (!sessions.length) { c.innerHTML = '<div class="empty">No sessions.</div>'; return; }
  c.innerHTML = sessions.map(s => \`
    <div class="item">
      <div class="item-name" onclick="send('viewSession',{projectId:'\${projectId}',id:'\${s.id}'})">
        \${s.provider}/\${s.model} \${statusBadge(s.status)}
      </div>
    </div>
  \`).join('');
}

/* ---- Render APIs ---- */
function renderApis(apis) {
  document.getElementById('apis-loading').style.display = 'none';
  const c = document.getElementById('apis-list');
  if (!apis.length) { c.innerHTML = '<div class="empty">No APIs yet.</div>'; return; }
  c.innerHTML = apis.map(a => \`
    <div class="item">
      <div class="item-name" onclick="toggleApiSub('\${a.id}')">\${esc(a.name)} \${statusBadge(a.status)}</div>
      <div class="item-actions">
        <button class="btn-icon" title="Edit" onclick="send('editApi',{id:'\${a.id}'})">✏️</button>
        <button class="btn-icon" title="Delete" onclick="send('deleteApi',{id:'\${a.id}',name:'\${esc(a.name)}'})">🗑️</button>
      </div>
    </div>
    <div class="sub" id="asub-\${a.id}" style="display:none">
      <div class="sub-hd" onclick="toggleApiSubSec('\${a.id}','configs')">
        Configs <button class="btn-icon" onclick="event.stopPropagation();send('createConfig',{apiId:'\${a.id}'})">＋</button>
      </div>
      <div class="sub-body" id="acfg-\${a.id}"></div>

      <div class="sub-hd" onclick="toggleApiSubSec('\${a.id}','schemas')">
        UI Schemas <button class="btn-icon" onclick="event.stopPropagation();send('createSchema',{apiId:'\${a.id}'})">＋</button>
      </div>
      <div class="sub-body" id="asch-\${a.id}"></div>

      <div class="sub-hd" onclick="toggleApiSubSec('\${a.id}','codes')">
        Generated Codes
      </div>
      <div class="sub-body" id="acod-\${a.id}"></div>

      <div class="sub-hd" onclick="toggleApiSubSec('\${a.id}','deployments')">
        Deployments <button class="btn-icon" onclick="event.stopPropagation();send('createDeployment',{apiId:'\${a.id}'})">＋</button>
      </div>
      <div class="sub-body" id="adep-\${a.id}"></div>
    </div>
  \`).join('');
}

function toggleApiSub(aid) {
  const el = document.getElementById('asub-' + aid);
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
function toggleApiSubSec(aid, type) {
  const map = { configs:'acfg', schemas:'asch', codes:'acod', deployments:'adep' };
  const el = document.getElementById(map[type] + '-' + aid);
  const open = el.classList.toggle('open');
  if (open) {
    el.innerHTML = '<div class="empty"><span class="spin">⟳</span> Loading...</div>';
    if (type === 'configs') send('loadConfigs', { apiId: aid });
    if (type === 'schemas') send('loadSchemas', { apiId: aid });
    if (type === 'codes') send('loadCodes', { apiId: aid });
    if (type === 'deployments') send('loadDeployments', { apiId: aid });
  }
}

function renderConfigs(apiId, configs) {
  const c = document.getElementById('acfg-' + apiId);
  if (!c) return;
  if (!configs.length) { c.innerHTML = '<div class="empty">No configs.</div>'; return; }
  c.innerHTML = configs.map(cfg => \`
    <div class="item">
      <div class="item-name">\${esc(cfg.key)}: \${cfg.is_secret ? '••••••' : esc(cfg.value)}</div>
      <div class="item-actions">
        <button class="btn-icon" title="Edit" onclick="send('editConfig',{apiId:'\${apiId}',id:'\${cfg.id}'})">✏️</button>
        <button class="btn-icon" title="Delete" onclick="send('deleteConfig',{apiId:'\${apiId}',id:'\${cfg.id}'})">🗑️</button>
      </div>
    </div>
  \`).join('');
}

function renderSchemas(apiId, schemas) {
  const c = document.getElementById('asch-' + apiId);
  if (!c) return;
  if (!schemas.length) { c.innerHTML = '<div class="empty">No schemas.</div>'; return; }
  c.innerHTML = schemas.map(s => \`
    <div class="item">
      <div class="item-name">\${esc(s.name)}</div>
      <div class="item-actions">
        <button class="btn-icon" title="Edit" onclick="send('editSchema',{apiId:'\${apiId}',id:'\${s.id}'})">✏️</button>
        <button class="btn-icon" title="Delete" onclick="send('deleteSchema',{apiId:'\${apiId}',id:'\${s.id}'})">🗑️</button>
      </div>
    </div>
  \`).join('');
}

function renderCodes(apiId, codes) {
  const c = document.getElementById('acod-' + apiId);
  if (!c) return;
  if (!codes.length) { c.innerHTML = '<div class="empty">No generated codes.</div>'; return; }
  c.innerHTML = codes.map(code => \`
    <div class="item">
      <div class="item-name" onclick="send('viewCode',{apiId:'\${apiId}',id:'\${code.id}'})">\${esc(code.file_path)}</div>
      <div class="item-actions">
        <button class="btn-icon" title="Apply to workspace" onclick="send('applyCode',{apiId:'\${apiId}',id:'\${code.id}'})">📁</button>
        <button class="btn-icon" title="Delete" onclick="send('deleteCode',{apiId:'\${apiId}',id:'\${code.id}'})">🗑️</button>
      </div>
    </div>
  \`).join('');
}

function renderDeployments(apiId, deployments) {
  const c = document.getElementById('adep-' + apiId);
  if (!c) return;
  if (!deployments.length) { c.innerHTML = '<div class="empty">No deployments.</div>'; return; }
  c.innerHTML = deployments.map(d => \`
    <div class="item">
      <div class="item-name">
        \${esc(d.provider || 'pending')} <span class="badge badge-info">\${d.environment}</span> \${statusBadge(d.status)}
        \${d.deploy_url ? '<a href="' + esc(d.deploy_url) + '" style="color:var(--accent);margin-left:4px;font-size:10px" target="_blank">🔗 View</a>' : ''}
      </div>
      <div class="item-actions">
        \${d.status === 'READY_TO_DEPLOY' ? '<button class="btn-icon" title="Start deployment" onclick="send(\\'startDeployment\\',{apiId:\\'' + apiId + '\\',id:\\'' + d.id + '\\'})" style="color:var(--ok)">▶️</button>' : ''}
        <button class="btn-icon" title="Update status" onclick="send('updateDeployment',{apiId:'\${apiId}',id:'\${d.id}'})">✏️</button>
        <button class="btn-icon" title="Delete" onclick="send('deleteDeployment',{apiId:'\${apiId}',id:'\${d.id}'})">🗑️</button>
      </div>
    </div>
    \${d.error_message ? '<div style="color:var(--err);font-size:10px;padding:2px 6px">' + esc(d.error_message) + '</div>' : ''}
  \`).join('');
}

/* ---- Listen for data from extension ---- */
window.addEventListener('message', e => {
  const { type, data } = e.data;
  switch (type) {
    case 'projects':    renderProjects(data); break;
    case 'apis':        renderApis(data); break;
    case 'documents':   renderDocuments(data.projectId, data.docs); break;
    case 'sessions':    renderSessions(data.projectId, data.sessions); break;
    case 'configs':     renderConfigs(data.apiId, data.configs); break;
    case 'schemas':     renderSchemas(data.apiId, data.schemas); break;
    case 'codes':       renderCodes(data.apiId, data.codes); break;
    case 'deployments': renderDeployments(data.apiId, data.deployments); break;
  }
});
</script>
</body></html>`;
  }
}

async function confirmDelete(thing: string): Promise<boolean> {
  const r = await vscode.window.showWarningMessage(
    `Delete ${thing}?`,
    { modal: true },
    "Delete",
  );
  return r === "Delete";
}
