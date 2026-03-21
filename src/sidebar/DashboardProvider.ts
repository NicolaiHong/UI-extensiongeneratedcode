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
import { apiDocumentsApi, DocumentType as ApiDocType } from "../api/apiDocuments.api";
import { extractApiError } from "../utils/errors";
import { escapeHtml } from "../utils/html";
import { showSessionReviewPanel } from "../utils/sessionReviewPanel";
import { showPreviewReviewPanel } from "../utils/apiWorkflowPanels";

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
        case "deleteDeployment":
          if (await confirmDelete("this deployment")) {
            await deploymentsApi.delete(msg.apiId, msg.id);
            vscode.window.showInformationMessage("Deployment deleted.");
            vscode.commands.executeCommand("uigenai.refreshSidebar");
          }
          break;

        /* ---- API Documents ---- */
        case "loadApiDocuments":
          this._post("apiDocuments", {
            apiId: msg.apiId,
            docs: await apiDocumentsApi.list(msg.apiId),
          });
          break;
        case "createApiDocument":
          await apiDocumentsApi.upsert(msg.apiId, msg.type as ApiDocType, {
            name: msg.name,
            content: msg.content,
          });
          vscode.window.showInformationMessage("Document created.");
          this._post("apiDocuments", {
            apiId: msg.apiId,
            docs: await apiDocumentsApi.list(msg.apiId),
          });
          break;
        case "viewApiDocument": {
          const doc = await apiDocumentsApi.get(msg.apiId, msg.type as ApiDocType);
          const lang = msg.type === "OPENAPI" ? "yaml" : "json";
          const td = await vscode.workspace.openTextDocument({
            content: doc.content,
            language: lang,
          });
          await vscode.window.showTextDocument(td, { preview: true });
          break;
        }
        case "deleteApiDocument":
          if (await confirmDelete("this document")) {
            await apiDocumentsApi.delete(msg.apiId, msg.type as ApiDocType);
            vscode.window.showInformationMessage("Document deleted.");
            this._post("apiDocuments", {
              apiId: msg.apiId,
              docs: await apiDocumentsApi.list(msg.apiId),
            });
          }
          break;

        /* ---- API Workflow (Preview / Full Source) ---- */
        case "selectApi":
          console.log("[uigenai] Received selectApi message:", msg.apiId);
          await this._loadApiWorkflow(msg.apiId);
          break;
        case "generatePreview":
          console.log(
            "[uigenai] Received generatePreview message:",
            msg.apiId,
            "sessionId:",
            msg.sessionId,
          );
          await this._generateApiSession(msg.apiId, "PREVIEW", msg.sessionId);
          break;
        case "generateFull":
          console.log(
            "[uigenai] Received generateFull message:",
            msg.apiId,
            "sessionId:",
            msg.sessionId,
          );
          await this._generateApiSession(
            msg.apiId,
            "FULL_SOURCE",
            msg.sessionId,
          );
          break;
        case "markReady":
          console.log("[uigenai] Received markReady message:", msg.apiId);
          await this._markApiReady(msg.apiId);
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

  private async _loadApiWorkflow(apiId: string) {
    console.log("[uigenai] _loadApiWorkflow called with apiId:", apiId);
    if (!apiId) {
      vscode.window.showErrorMessage("Select an API first.");
      return;
    }
    try {
      console.log("[uigenai] Fetching API and sessions for:", apiId);
      const [api, previewSessions, fullSessions] = await Promise.all([
        apisApi.getById(apiId),
        apisApi.listSessions(apiId, "PREVIEW"),
        apisApi.listSessions(apiId, "FULL_SOURCE"),
      ]);

      console.log(
        "[uigenai] API loaded:",
        api.name,
        "workflow_state:",
        api.workflow_state,
      );
      console.log("[uigenai] Preview sessions:", previewSessions?.length || 0);
      console.log("[uigenai] Full sessions:", fullSessions?.length || 0);

      const sortByDate = (arr: any[]) =>
        [...(arr || [])].sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );

      const preview = sortByDate(previewSessions)[0] || null;
      const full = sortByDate(fullSessions)[0] || null;

      console.log("[uigenai] Latest preview:", preview?.id, preview?.status);
      console.log("[uigenai] Latest full:", full?.id, full?.status);

      this._post("apiWorkflow", {
        api,
        preview: preview
          ? {
              id: preview.id,
              status: preview.status,
              created_at: preview.created_at,
              project_id: preview.project_id,
            }
          : null,
        full: full
          ? {
              id: full.id,
              status: full.status,
              created_at: full.created_at,
              project_id: full.project_id,
            }
          : null,
      });
    } catch (e: unknown) {
      console.error("[uigenai] _loadApiWorkflow error:", e);
      vscode.window.showErrorMessage(extractApiError(e));
    }
  }

  private async _generateApiSession(
    apiId: string,
    mode: "PREVIEW" | "FULL_SOURCE",
    reuseSessionId?: string,
  ) {
    console.log("[uigenai] _generateApiSession called:", {
      apiId,
      mode,
      reuseSessionId: reuseSessionId || "new",
    });
    if (!apiId) {
      vscode.window.showErrorMessage("Select an API first.");
      return;
    }

    try {
      const api = await apisApi.getById(apiId);
      console.log("[uigenai] API loaded for generation:", api.name);

      let session: Session;
      if (reuseSessionId) {
        // Use API-scoped session getter
        session = await apisApi.getSession(apiId, reuseSessionId);
      } else {
        session = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title:
              mode === "PREVIEW"
                ? "Generating Preview UI..."
                : "Generating Full Source...",
          },
          // Use API-scoped session runner (no project required)
          async () => apisApi.runSession(apiId, { mode }),
        );
      }

      const finalSession =
        session.status === "SUCCEEDED"
          ? session
          : await this._pollApiSession(apiId, session.id);

      console.log(
        "[uigenai] Session result:",
        finalSession.id,
        "status:",
        finalSession.status,
      );

      if (finalSession.status !== "SUCCEEDED") {
        console.log("[uigenai] Generation failed:", finalSession.status);
        vscode.window.showErrorMessage(
          `Generation ${finalSession.status.toLowerCase()}.`,
        );
        await this._loadApiWorkflow(api.id);
        return;
      }

      if (mode === "PREVIEW") {
        console.log("[uigenai] Opening Preview Review panel for:", api.name);
        showPreviewReviewPanel({
          apiName: api.name,
          session: finalSession,
          onGenerateFull: () => this._generateApiSession(api.id, "FULL_SOURCE"),
          onRegenerate: () => this._generateApiSession(api.id, "PREVIEW"),
        });
      } else {
        console.log(
          "[uigenai] Opening Full Source Review panel for:",
          api.name,
          "session:",
          finalSession.id,
        );
        // Pass project_id if available, otherwise pass empty string (panel will handle it)
        await showSessionReviewPanel(api.project_id || "", finalSession.id, {
          apiId: api.id,
          enableMarkReady: true,
          onMarkedReady: () => this._loadApiWorkflow(api.id),
        });
      }

      await this._loadApiWorkflow(api.id);
      vscode.commands.executeCommand("uigenai.refreshSidebar");
    } catch (e: unknown) {
      console.error("[uigenai] _generateApiSession error:", e);
      vscode.window.showErrorMessage(extractApiError(e));
    }
  }

  private async _pollSession(
    projectId: string,
    sessionId: string,
    maxWaitMs = 300_000,
    intervalMs = 3_000,
  ): Promise<Session> {
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      const session = await sessionsApi.getById(projectId, sessionId);

      if (session.status === "SUCCEEDED" || session.status === "FAILED") {
        return session;
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }

    return {
      id: sessionId,
      api_id: null,
      project_id: projectId,
      provider: "",
      model: "",
      mode: "FULL_SOURCE",
      status: "FAILED",
      error_message: "Timed out waiting for generation to complete.",
      output_summary_md: null,
      created_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    };
  }

  private async _pollApiSession(
    apiId: string,
    sessionId: string,
    maxWaitMs = 300_000,
    intervalMs = 3_000,
  ): Promise<Session> {
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      const session = await apisApi.getSession(apiId, sessionId);

      if (session.status === "SUCCEEDED" || session.status === "FAILED") {
        return session;
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }

    return {
      id: sessionId,
      api_id: apiId,
      project_id: "",
      provider: "",
      model: "",
      mode: "FULL_SOURCE",
      status: "FAILED",
      error_message: "Timed out waiting for generation to complete.",
      output_summary_md: null,
      created_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    };
  }

  private async _markApiReady(apiId: string) {
    console.log("[uigenai] _markApiReady called with apiId:", apiId);
    if (!apiId) {
      vscode.window.showErrorMessage("Select an API first.");
      return;
    }
    try {
      console.log("[uigenai] Marking API as ready to deploy:", apiId);
      await apisApi.markReadyToDeploy(apiId);
      console.log("[uigenai] API marked as ready successfully");
      vscode.window.showInformationMessage("API marked Ready to Deploy.");
      await this._loadApiWorkflow(apiId);
      vscode.commands.executeCommand("uigenai.refreshSidebar");
    } catch (e: unknown) {
      console.error("[uigenai] _markApiReady error:", e);
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
button:disabled{opacity:0.4;cursor:not-allowed;pointer-events:auto}
button:disabled:hover{filter:none;background:inherit}
.btn-p{background:var(--accent);color:#fff}.btn-p:hover:not(:disabled){filter:brightness(1.2)}
.btn-s{background:transparent;color:var(--text2);border:1px solid var(--border)}.btn-s:hover:not(:disabled){background:var(--border)}
.btn-d{background:transparent;color:var(--err)}.btn-d:hover:not(:disabled){background:rgba(244,71,71,.15)}
.btn-icon{background:transparent;color:var(--text2);padding:2px 4px;font-size:13px}.btn-icon:hover:not(:disabled){color:var(--text)}

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

/* Workflow */
.wf{padding:10px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:8px}
.wf-row{display:flex;align-items:center;gap:6px}
.wf-select{flex:1;background:var(--card);border:1px solid var(--border);color:var(--text);padding:6px;border-radius:4px;font-size:11px}
.wf-select:focus{outline:1px solid var(--accent)}
.wf-badge{font-size:10px;padding:2px 8px;border-radius:10px;font-weight:700;text-transform:uppercase;border:1px solid var(--border)}
.wf-badge.ok{color:var(--ok);border-color:rgba(78,201,176,.4)}
.wf-badge.warn{color:var(--warn);border-color:rgba(220,220,170,.4)}
.wf-badge.err{color:var(--err);border-color:rgba(244,71,71,.4)}
.wf-badge.info{color:var(--accent2);border-color:rgba(0,122,204,.4)}
.wf-meta{font-size:10px;color:var(--text2)}
.wf-cta{display:flex;flex-wrap:wrap;gap:6px}
.wf-cta button{flex:1;min-width:120px}
.wf-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}
.wf-card{background:var(--card);border:1px solid var(--border);border-radius:6px;padding:8px;font-size:11px}
.wf-card h4{font-size:11px;margin-bottom:4px;color:var(--text)}
.wf-card .sub{font-size:10px;color:var(--text2)}
.wf-inline{display:flex;align-items:center;justify-content:space-between;font-size:10px;color:var(--text2)}

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
<!-- API Workflow -->
<div class="section" id="sec-workflow">
  <div class="sec-hd" onclick="toggleSec('workflow')">
    <h3>API Workflow</h3>
    <span class="arrow open" id="arrow-workflow">&#9654;</span>
  </div>
  <div class="sec-body open" id="body-workflow">
    <div class="wf">
      <div class="wf-row">
        <select class="wf-select" id="wf-select" onchange="onSelectWorkflow(this.value)"></select>
        <span class="wf-badge info" id="wf-state">--</span>
      </div>
      <div class="wf-meta" id="wf-meta">Select an API to see actions.</div>
      <div class="wf-cta">
        <button class="btn-p" id="wf-btn-preview" onclick="clickPreview()" disabled>Preview UI</button>
        <button class="btn-s" id="wf-btn-full" onclick="clickFull()" disabled>Generate Full Source</button>
        <button class="btn-s" id="wf-btn-ready" onclick="clickReady()" disabled>Mark Ready</button>
      </div>
      <div class="wf-cards">
        <div class="wf-card">
          <h4>Preview</h4>
          <div class="sub" id="wf-preview-status">No preview run.</div>
          <div class="wf-inline" id="wf-preview-meta"></div>
          <button class="btn-s" style="width:100%;margin-top:6px" onclick="reviewPreview()" id="wf-preview-view" disabled>Review Preview</button>
        </div>
        <div class="wf-card">
          <h4>Full Source</h4>
          <div class="sub" id="wf-full-status">No full run.</div>
          <div class="wf-inline" id="wf-full-meta"></div>
          <button class="btn-s" style="width:100%;margin-top:6px" onclick="reviewFull()" id="wf-full-view" disabled>Review Full Source</button>
        </div>
      </div>
    </div>
  </div>
</div>

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

<!-- Add Document Modal -->
<div id="add-doc-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:999;align-items:center;justify-content:center">
  <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px;width:90%;max-width:400px;max-height:80%;overflow:auto">
    <h3 style="margin-bottom:12px">Add Document</h3>
    <label style="display:block;margin-bottom:4px;color:var(--text2);font-size:11px">Type:</label>
    <select id="doc-type-select" style="width:100%;padding:6px;margin-bottom:12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px">
      <option value="OPENAPI">OPENAPI</option>
      <option value="ENTITY_SCHEMA">ENTITY_SCHEMA</option>
      <option value="ACTION_SPEC">ACTION_SPEC</option>
      <option value="DESIGN_SYSTEM">DESIGN_SYSTEM</option>
    </select>
    <label style="display:block;margin-bottom:4px;color:var(--text2);font-size:11px">Name:</label>
    <input id="doc-name-input" type="text" placeholder="e.g. api-spec.yaml" style="width:100%;padding:6px;margin-bottom:12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px">
    <label style="display:block;margin-bottom:4px;color:var(--text2);font-size:11px">Content:</label>
    <textarea id="doc-content-input" rows="8" placeholder="Paste your OpenAPI/JSON content here..." style="width:100%;padding:6px;margin-bottom:12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;font-family:monospace;font-size:11px;resize:vertical"></textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn-s" onclick="hideAddDocModal()">Cancel</button>
      <button class="btn-p" onclick="submitAddDoc()">Add</button>
    </div>
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();
function send(cmd, extra) { vscode.postMessage(Object.assign({ cmd }, extra || {})); }
function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }
let selectedApiId = null;
let workflowApis = [];
let workflowLatest = { preview: null, full: null };

/* ---- Section toggle ---- */
function toggleSec(id) {
  const b = document.getElementById('body-' + id);
  const a = document.getElementById('arrow-' + id);
  const open = b.classList.toggle('open');
  a.classList.toggle('open', open);
  if (open) {
    if (id === 'projects') send('loadProjects');
    if (id === 'apis') send('loadApis');
    if (id === 'workflow') send('loadApis');
  }
}

/* ---- Workflow helpers ---- */
function setWorkflowApis(apis) {
  workflowApis = apis || [];
  console.log('[uigenai][workflow] API list loaded', workflowApis.map(a => a.name));
  const sel = document.getElementById('wf-select');
  if (!sel) return;
  if (!workflowApis.length) {
    sel.innerHTML = '<option value="">No APIs yet</option>';
    selectedApiId = null;
    renderWorkflow(null);
    return;
  }
  sel.innerHTML = workflowApis
    .map(a => \`<option value="\${a.id}">\${esc(a.name)}</option>\`)
    .join('');
  if (!selectedApiId || !workflowApis.some(a => a.id === selectedApiId)) {
    selectedApiId = workflowApis[0].id;
  }
  sel.value = selectedApiId;
  console.log('[uigenai][workflow] selecting api', selectedApiId);
  send('selectApi', { apiId: selectedApiId });
}

function onSelectWorkflow(id) {
  selectedApiId = id || null;
  console.log('[uigenai][workflow] API selection changed:', selectedApiId);
  workflowLatest = { preview: null, full: null };
  if (!selectedApiId) {
    console.log('[uigenai][workflow] No API selected, clearing workflow');
    renderWorkflow(null);
    return;
  }
  // Show loading state - disable all buttons while loading
  document.getElementById('wf-meta').textContent = 'Loading workflow...';
  const btnPreview = document.getElementById('wf-btn-preview');
  const btnFull = document.getElementById('wf-btn-full');
  const btnReady = document.getElementById('wf-btn-ready');
  const pvBtn = document.getElementById('wf-preview-view');
  const fsBtn = document.getElementById('wf-full-view');
  [btnPreview, btnFull, btnReady, pvBtn, fsBtn].forEach(b => {
    if (b) { b.disabled = true; b.title = 'Loading workflow data...'; }
  });
  console.log('[uigenai][workflow] Requesting workflow data for API:', selectedApiId);
  send('selectApi', { apiId: selectedApiId });
}

function renderWorkflow(payload) {
  const stateEl = document.getElementById('wf-state');
  const metaEl = document.getElementById('wf-meta');
  const btnPreview = document.getElementById('wf-btn-preview');
  const btnFull = document.getElementById('wf-btn-full');
  const btnReady = document.getElementById('wf-btn-ready');
  const pvStatus = document.getElementById('wf-preview-status');
  const pvMeta = document.getElementById('wf-preview-meta');
  const pvBtn = document.getElementById('wf-preview-view');
  const fsStatus = document.getElementById('wf-full-status');
  const fsMeta = document.getElementById('wf-full-meta');
  const fsBtn = document.getElementById('wf-full-view');

  console.log('[uigenai][workflow] renderWorkflow called with payload:', payload);

  if (!payload) {
    console.log('[uigenai][workflow] No payload - disabling all buttons');
    if (stateEl) {
      stateEl.textContent = "--";
      stateEl.className = "wf-badge info";
    }
    if (metaEl) metaEl.textContent = "Select an API to see actions.";
    [btnPreview, btnFull, btnReady, pvBtn, fsBtn].forEach((b) => {
      if (b) {
        b.disabled = true;
        b.title = "Select an API first.";
      }
    });
    if (pvStatus) pvStatus.textContent = "No preview run.";
    if (pvMeta) pvMeta.textContent = "";
    if (fsStatus) fsStatus.textContent = "No full run.";
    if (fsMeta) fsMeta.textContent = "";
    workflowLatest = { preview: null, full: null };
    return;
  }

  if (selectedApiId && payload.api.id !== selectedApiId) {
    console.log('[uigenai][workflow] Ignoring stale payload for API:', payload.api.id, '(current:', selectedApiId, ')');
    return;
  }

  console.log('[uigenai][workflow] Processing workflow for API:', payload.api.name, 'state:', payload.api.workflow_state);
  console.log('[uigenai][workflow] Preview session:', payload.preview);
  console.log('[uigenai][workflow] Full session:', payload.full);

  workflowLatest = { preview: payload.preview, full: payload.full };

  const state = (payload.api.workflow_state || "CONFIGURED").replace(/_/g, " ");
  const badgeClass =
    payload.api.workflow_state === "READY_TO_DEPLOY"
      ? "wf-badge ok"
      : payload.api.workflow_state === "CODE_GENERATED"
        ? "wf-badge info"
        : payload.api.workflow_state === "FAILED"
          ? "wf-badge err"
          : "wf-badge warn";
  if (stateEl) {
    stateEl.textContent = state;
    stateEl.className = badgeClass;
  }
  if (metaEl) metaEl.textContent = \`API: \${payload.api.name}\`;

  // Calculate button enable conditions
  const previewReady = Boolean(selectedApiId);
  const fullReady =
    Boolean(payload.preview) && payload.preview.status === "SUCCEEDED";
  const markReadyReady =
    payload.api.workflow_state === "CODE_GENERATED" &&
    Boolean(payload.full) &&
    payload.full.status === "SUCCEEDED";

  console.log('[uigenai][workflow] Button states:', {
    previewReady,
    fullReady,
    markReadyReady,
    previewSession: payload.preview?.status,
    fullSession: payload.full?.status,
    workflowState: payload.api.workflow_state
  });

  if (btnPreview) {
    btnPreview.disabled = !previewReady;
    btnPreview.title = previewReady ? "Generate a UI preview for this API" : "Select an API first.";
    console.log('[uigenai][workflow] Preview UI button:', previewReady ? 'ENABLED' : 'DISABLED');
  }
  if (btnFull) {
    btnFull.disabled = !fullReady;
    btnFull.title = fullReady
      ? "Generate full source code from the preview"
      : \`Disabled: \${!payload.preview ? 'No preview session exists' : 'Preview status is ' + payload.preview.status + ' (needs SUCCEEDED)'}\`;
    console.log('[uigenai][workflow] Generate Full button:', fullReady ? 'ENABLED' : 'DISABLED -', btnFull.title);
  }
  if (btnReady) {
    btnReady.disabled = !markReadyReady;
    const reasons = [];
    if (payload.api.workflow_state !== "CODE_GENERATED") reasons.push(\`workflow state is \${payload.api.workflow_state || 'CONFIGURED'} (needs CODE_GENERATED)\`);
    if (!payload.full) reasons.push('no full source session exists');
    else if (payload.full.status !== "SUCCEEDED") reasons.push(\`full source status is \${payload.full.status} (needs SUCCEEDED)\`);
    btnReady.title = markReadyReady
      ? "Mark this API as ready to deploy"
      : \`Disabled: \${reasons.join(', ')}\`;
    console.log('[uigenai][workflow] Mark Ready button:', markReadyReady ? 'ENABLED' : 'DISABLED -', btnReady.title);
  }

  if (pvStatus)
    pvStatus.textContent = payload.preview
      ? \`Latest: \${payload.preview.status}\`
      : "No preview run.";
  if (pvMeta)
    pvMeta.textContent = payload.preview
      ? new Date(payload.preview.created_at).toLocaleString()
      : "";
  if (pvBtn) {
    const canReview = payload.preview && payload.preview.status === "SUCCEEDED";
    pvBtn.disabled = !canReview;
    pvBtn.title = canReview
      ? "Open the preview session for review"
      : \`Disabled: \${!payload.preview ? 'No preview session exists' : 'Preview status is ' + payload.preview.status + ' (needs SUCCEEDED)'}\`;
    console.log('[uigenai][workflow] Review Preview button:', canReview ? 'ENABLED' : 'DISABLED');
  }

  if (fsStatus)
    fsStatus.textContent = payload.full
      ? \`Latest: \${payload.full.status}\`
      : "No full run.";
  if (fsMeta)
    fsMeta.textContent = payload.full
      ? new Date(payload.full.created_at).toLocaleString()
      : "";
  if (fsBtn) {
    const canReviewFull = payload.full && payload.full.status === "SUCCEEDED";
    fsBtn.disabled = !canReviewFull;
    fsBtn.title = canReviewFull
      ? "Open the full source session for review"
      : \`Disabled: \${!payload.full ? 'No full source session exists' : 'Full source status is ' + payload.full.status + ' (needs SUCCEEDED)'}\`;
    console.log('[uigenai][workflow] Review Full Source button:', canReviewFull ? 'ENABLED' : 'DISABLED');
  }
}

function setWorkflowMessage(msg) {
  const metaEl = document.getElementById('wf-meta');
  if (metaEl) metaEl.textContent = msg;
}

function clickPreview() {
  console.log('[uigenai][workflow] Preview UI click', selectedApiId);
  if (!selectedApiId) {
    setWorkflowMessage("Select an API first.");
    return;
  }
  send('generatePreview', { apiId: selectedApiId });
}

function clickFull() {
  console.log('[uigenai][workflow] Generate Full click', {
    api: selectedApiId,
    preview: workflowLatest.preview,
  });
  if (!workflowLatest.preview || workflowLatest.preview.status !== "SUCCEEDED") {
    setWorkflowMessage("Run a successful Preview UI first.");
    return;
  }
  send('generateFull', { apiId: selectedApiId });
}

function clickReady() {
  console.log('[uigenai][workflow] Mark Ready click', {
    api: selectedApiId,
    full: workflowLatest.full,
  });
  if (!workflowLatest.full || workflowLatest.full.status !== "SUCCEEDED") {
    setWorkflowMessage("Generate a successful Full Source first.");
    return;
  }
  send('markReady', { apiId: selectedApiId });
}

function reviewPreview() {
  console.log('[uigenai][workflow] Review preview click', workflowLatest.preview);
  if (!workflowLatest.preview || workflowLatest.preview.status !== "SUCCEEDED") {
    setWorkflowMessage("No successful preview session to review.");
    return;
  }
  send('generatePreview', {
    apiId: selectedApiId,
    sessionId: workflowLatest.preview.id,
  });
}
function reviewFull() {
  console.log('[uigenai][workflow] Review full click', workflowLatest.full);
  if (!workflowLatest.full || workflowLatest.full.status !== "SUCCEEDED") {
    setWorkflowMessage("No successful full-source session to review.");
    return;
  }
  send('generateFull', {
    apiId: selectedApiId,
    sessionId: workflowLatest.full.id,
  });
}

/* ---- Status badge helper ---- */
function statusBadge(s) {
  if (!s) return '';
  const map = { ACTIVE:'ok', DEPLOYED:'ok', SUCCEEDED:'ok', INACTIVE:'warn', PENDING:'warn', QUEUED:'warn', IN_PROGRESS:'info', RUNNING:'info', DEPRECATED:'err', FAILED:'err', ROLLED_BACK:'err' };
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
  setWorkflowApis(apis);
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
      <div class="sub-hd" onclick="toggleApiSubSec('\${a.id}','apidocs')">
        Documents <button class="btn-icon" onclick="event.stopPropagation();showAddDocModal('\${a.id}')" title="Add Document">＋</button>
      </div>
      <div class="sub-body" id="adoc-\${a.id}"></div>

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
  const map = { apidocs:'adoc', configs:'acfg', schemas:'asch', codes:'acod', deployments:'adep' };
  const el = document.getElementById(map[type] + '-' + aid);
  const open = el.classList.toggle('open');
  if (open) {
    el.innerHTML = '<div class="empty"><span class="spin">⟳</span> Loading...</div>';
    if (type === 'apidocs') send('loadApiDocuments', { apiId: aid });
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
        \${esc(d.provider || 'deploy')} <span class="badge badge-info">\${d.environment}</span> \${statusBadge(d.status)}
      </div>
      <div class="item-actions">
        <button class="btn-icon" title="Update status" onclick="send('updateDeployment',{apiId:'\${apiId}',id:'\${d.id}'})">✏️</button>
        <button class="btn-icon" title="Delete" onclick="send('deleteDeployment',{apiId:'\${apiId}',id:'\${d.id}'})">🗑️</button>
      </div>
    </div>
  \`).join('');
}

function renderApiDocuments(apiId, docs) {
  const c = document.getElementById('adoc-' + apiId);
  if (!c) return;
  if (!docs || !docs.length) { c.innerHTML = '<div class="empty">No documents. Click + to add.</div>'; return; }
  c.innerHTML = docs.map(d => \`
    <div class="item">
      <div class="item-name" onclick="send('viewApiDocument',{apiId:'\${apiId}',type:'\${d.type}'})">
        \${esc(d.name)} <span class="badge badge-info">\${d.type}</span>
      </div>
      <div class="item-actions">
        <button class="btn-icon" title="Delete" onclick="send('deleteApiDocument',{apiId:'\${apiId}',type:'\${d.type}'})">🗑️</button>
      </div>
    </div>
  \`).join('');
}

let addDocApiId = null;
function showAddDocModal(apiId) {
  addDocApiId = apiId;
  const modal = document.getElementById('add-doc-modal');
  if (modal) modal.style.display = 'flex';
}
function hideAddDocModal() {
  const modal = document.getElementById('add-doc-modal');
  if (modal) modal.style.display = 'none';
  addDocApiId = null;
}
function submitAddDoc() {
  const type = document.getElementById('doc-type-select').value;
  const name = document.getElementById('doc-name-input').value.trim();
  const content = document.getElementById('doc-content-input').value;
  if (!name || !content) { alert('Name and content are required'); return; }
  send('createApiDocument', { apiId: addDocApiId, type, name, content });
  hideAddDocModal();
}

${user ? "console.log('[uigenai][workflow] Page loaded, user logged in. Requesting API list...'); send('loadApis');" : "console.log('[uigenai][workflow] Page loaded, user not logged in. Workflow disabled.');"}

/* ---- Listen for data from extension ---- */
window.addEventListener('message', e => {
  const { type, data } = e.data;
  console.log('[uigenai][workflow] Received message:', type, type === 'apiWorkflow' ? data : '(data omitted)');
  switch (type) {
    case 'projects':    renderProjects(data); break;
    case 'apis':
      console.log('[uigenai][workflow] APIs received, count:', data?.length || 0);
      renderApis(data);
      break;
    case 'documents':   renderDocuments(data.projectId, data.docs); break;
    case 'sessions':    renderSessions(data.projectId, data.sessions); break;
    case 'configs':     renderConfigs(data.apiId, data.configs); break;
    case 'schemas':     renderSchemas(data.apiId, data.schemas); break;
    case 'codes':       renderCodes(data.apiId, data.codes); break;
    case 'deployments': renderDeployments(data.apiId, data.deployments); break;
    case 'apiDocuments': renderApiDocuments(data.apiId, data.docs); break;
    case 'apiWorkflow':
      console.log('[uigenai][workflow] Workflow data received for API:', data?.api?.name);
      renderWorkflow(data);
      break;
  }
});
</script>

<!-- Add Document Modal -->
<div id="add-doc-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:999;align-items:center;justify-content:center">
  <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px;width:90%;max-width:400px;max-height:80vh;overflow:auto">
    <h3 style="margin-bottom:12px;font-size:13px">Add Document</h3>
    <div style="margin-bottom:10px">
      <label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">Type</label>
      <select id="doc-type-select" style="width:100%;padding:6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px">
        <option value="OPENAPI">OPENAPI</option>
        <option value="ENTITY_SCHEMA">ENTITY_SCHEMA</option>
        <option value="ACTION_SPEC">ACTION_SPEC</option>
        <option value="DESIGN_SYSTEM">DESIGN_SYSTEM</option>
      </select>
    </div>
    <div style="margin-bottom:10px">
      <label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">Name</label>
      <input id="doc-name-input" type="text" placeholder="e.g. openapi.yaml" style="width:100%;padding:6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px">
    </div>
    <div style="margin-bottom:12px">
      <label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">Content</label>
      <textarea id="doc-content-input" rows="10" placeholder="Paste your OpenAPI/YAML/JSON content here..." style="width:100%;padding:6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-family:monospace;font-size:11px;resize:vertical"></textarea>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn-s" onclick="hideAddDocModal()">Cancel</button>
      <button class="btn-p" onclick="submitAddDoc()">Add</button>
    </div>
  </div>
</div>

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
