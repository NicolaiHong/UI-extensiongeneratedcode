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
import {
  apiDocumentsApi,
  DocumentType as ApiDocType,
} from "../api/apiDocuments.api";
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
          const doc = await apiDocumentsApi.get(
            msg.apiId,
            msg.type as ApiDocType,
          );
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
        case "loadApiOpenApiDoc":
          try {
            const doc = await apiDocumentsApi.get(
              msg.apiId,
              "OPENAPI" as ApiDocType,
            );
            if (doc && doc.content) {
              this._post("apiOpenApiDoc", {
                apiId: msg.apiId,
                content: doc.content,
                name: doc.name || "openapi.yaml",
              });
            } else {
              this._post("apiOpenApiDocError", {
                apiId: msg.apiId,
                error: "No OpenAPI document found for this API",
              });
            }
          } catch (e: unknown) {
            this._post("apiOpenApiDocError", {
              apiId: msg.apiId,
              error: extractApiError(e),
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
            "provider:",
            msg.provider,
            "model:",
            msg.model,
            "customPrompt:",
            msg.customPrompt
              ? msg.customPrompt.substring(0, 50) + "..."
              : "(none)",
          );
          await this._generateApiSession(
            msg.apiId,
            "PREVIEW",
            msg.sessionId,
            msg.provider,
            msg.model,
            msg.customPrompt,
          );
          break;
        case "generateFull":
          console.log(
            "[uigenai] Received generateFull message:",
            msg.apiId,
            "provider:",
            msg.provider,
            "model:",
            msg.model,
            "customPrompt:",
            msg.customPrompt
              ? msg.customPrompt.substring(0, 50) + "..."
              : "(none)",
          );
          await this._generateApiSession(
            msg.apiId,
            "FULL_SOURCE",
            msg.sessionId,
            msg.provider,
            msg.model,
            msg.customPrompt,
          );
          break;
        case "markReady":
          console.log("[uigenai] Received markReady message:", msg.apiId);
          await this._markApiReady(msg.apiId);
          break;

        /* ---- Session Review/Delete ---- */
        case "reviewPreviewSession":
          console.log(
            "[uigenai] Review preview session:",
            msg.apiId,
            msg.sessionId,
          );
          await this._reviewSession(msg.apiId, msg.sessionId, "PREVIEW");
          break;
        case "reviewFullSession":
          console.log(
            "[uigenai] Review full session:",
            msg.apiId,
            msg.sessionId,
          );
          await this._reviewSession(msg.apiId, msg.sessionId, "FULL_SOURCE");
          break;
        case "deleteApiSession":
          console.log("[uigenai] Delete session:", msg.apiId, msg.sessionId);
          await this._deleteApiSession(msg.apiId, msg.sessionId);
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

        /* ---- Quick Generate (Local Flow) ---- */
        case "pickOpenApiFile":
          await this._pickOpenApiFile();
          break;
        case "quickGenerate":
          await this._quickGenerate(msg);
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

      const sortedPreview = sortByDate(previewSessions);
      const sortedFull = sortByDate(fullSessions);

      console.log(
        "[uigenai] Latest preview:",
        sortedPreview[0]?.id,
        sortedPreview[0]?.status,
      );
      console.log(
        "[uigenai] Latest full:",
        sortedFull[0]?.id,
        sortedFull[0]?.status,
      );

      this._post("apiWorkflow", {
        api,
        // Keep latest for backward compatibility
        preview: sortedPreview[0]
          ? {
              id: sortedPreview[0].id,
              status: sortedPreview[0].status,
              created_at: sortedPreview[0].created_at,
              project_id: sortedPreview[0].project_id,
            }
          : null,
        full: sortedFull[0]
          ? {
              id: sortedFull[0].id,
              status: sortedFull[0].status,
              created_at: sortedFull[0].created_at,
              project_id: sortedFull[0].project_id,
            }
          : null,
        // Send all sessions for the list view
        allPreviewSessions: sortedPreview.map((s: any) => ({
          id: s.id,
          status: s.status,
          created_at: s.created_at,
          project_id: s.project_id,
          provider: s.provider,
          model: s.model,
        })),
        allFullSessions: sortedFull.map((s: any) => ({
          id: s.id,
          status: s.status,
          created_at: s.created_at,
          project_id: s.project_id,
          provider: s.provider,
          model: s.model,
        })),
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
    provider?: string,
    model?: string,
    customPrompt?: string,
  ) {
    const selectedProvider = provider || "gemini";
    const selectedModel = model || "gemini-2.5-flash";
    console.log("[uigenai] _generateApiSession called:", {
      apiId,
      mode,
      reuseSessionId: reuseSessionId || "new",
      provider: selectedProvider,
      model: selectedModel,
      customPrompt: customPrompt
        ? customPrompt.substring(0, 50) + "..."
        : "(none)",
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
          async () =>
            apisApi.runSession(apiId, {
              mode,
              provider: selectedProvider,
              model: selectedModel,
              customPrompt: customPrompt || undefined,
            }),
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

  private async _reviewSession(
    apiId: string,
    sessionId: string,
    mode: "PREVIEW" | "FULL_SOURCE",
  ) {
    console.log("[uigenai] _reviewSession called:", { apiId, sessionId, mode });
    if (!apiId || !sessionId) {
      vscode.window.showErrorMessage("Invalid session.");
      return;
    }
    try {
      const [api, session] = await Promise.all([
        apisApi.getById(apiId),
        apisApi.getSession(apiId, sessionId),
      ]);

      if (mode === "PREVIEW") {
        showPreviewReviewPanel({
          apiName: api.name,
          session,
          onGenerateFull: () => this._generateApiSession(api.id, "FULL_SOURCE"),
          onRegenerate: () => this._generateApiSession(api.id, "PREVIEW"),
        });
      } else {
        await showSessionReviewPanel(api.project_id || "", sessionId, {
          apiId: api.id,
          enableMarkReady: true,
          onMarkedReady: () => this._loadApiWorkflow(api.id),
        });
      }
    } catch (e: unknown) {
      console.error("[uigenai] _reviewSession error:", e);
      vscode.window.showErrorMessage(extractApiError(e));
    }
  }

  private async _deleteApiSession(apiId: string, sessionId: string) {
    console.log("[uigenai] _deleteApiSession called:", { apiId, sessionId });
    if (!apiId || !sessionId) {
      vscode.window.showErrorMessage("Invalid session.");
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      "Delete this session? This cannot be undone.",
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") {
      return;
    }
    try {
      await apisApi.deleteSession(apiId, sessionId);
      vscode.window.showInformationMessage("Session deleted.");
      await this._loadApiWorkflow(apiId);
    } catch (e: unknown) {
      console.error("[uigenai] _deleteApiSession error:", e);
      vscode.window.showErrorMessage(extractApiError(e));
    }
  }

  /* ---- Quick Generate (Local Flow) ---- */
  private async _pickOpenApiFile() {
    const files = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        "OpenAPI Files": ["yaml", "yml", "json"],
        "All Files": ["*"],
      },
      title: "Select OpenAPI/Swagger File",
    });

    if (!files || files.length === 0) {
      return;
    }

    const filePath = files[0].fsPath;
    try {
      const content = await vscode.workspace.fs.readFile(files[0]);
      const textContent = Buffer.from(content).toString("utf-8");
      this._post("qgFileSelected", { filePath, content: textContent });
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to read file: ${e.message}`);
    }
  }

  private async _quickGenerate(msg: {
    apiFilePath: string;
    apiContent: string;
    useSkill: boolean;
    skillName: string;
    actionsPrompt: string;
    designPrompt: string;
    provider: string;
    model: string;
  }) {
    console.log("[uigenai] _quickGenerate called:", {
      file: msg.apiFilePath,
      useSkill: msg.useSkill,
      skillName: msg.skillName,
      provider: msg.provider,
      model: msg.model,
    });

    try {
      // Import the preview generator
      const { generatePreviewAndShow } =
        await import("../commands/previewGenerateCommand");

      // Build the state object for preview generation
      const state = {
        apiSpec: msg.apiContent,
        actionsPrompt: msg.actionsPrompt || undefined,
        designPrompt: msg.designPrompt || undefined,
        provider: msg.provider,
        model: msg.model,
        apiFilePath: msg.apiFilePath,
        useSkill: msg.useSkill,
        skillName: msg.skillName,
      };

      // Generate preview
      await generatePreviewAndShow(this._extensionUri as any, state);

      this._post("qgStatus", { success: true, message: "Preview generated!" });
    } catch (e: any) {
      console.error("[uigenai] _quickGenerate error:", e);
      vscode.window.showErrorMessage(`Quick generate failed: ${e.message}`);
      this._post("qgStatus", { success: false, message: e.message });
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
.wf-row{display:flex;align-items:center;gap:6px;width:100%}
.wf-select{flex:1;background:var(--card);border:1px solid var(--border);color:var(--text);padding:6px;border-radius:4px;font-size:11px;min-width:0}
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

/* Sessions List */
.wf-sessions{background:var(--card);border:1px solid var(--border);border-radius:6px;overflow:hidden}
.wf-sessions-header{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,.02);border-bottom:1px solid var(--border)}
.wf-sessions-header h4{font-size:11px;font-weight:600;color:var(--text);margin:0}
.wf-sessions-count{font-size:10px;background:var(--accent);color:#fff;padding:1px 6px;border-radius:10px;font-weight:600}
.wf-sessions-list{max-height:200px;overflow-y:auto}
.wf-session-item{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border);font-size:11px}
.wf-session-item:last-child{border-bottom:none}
.wf-session-item:hover{background:rgba(255,255,255,.03)}
.wf-session-info{flex:1;min-width:0}
.wf-session-model{font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wf-session-date{font-size:10px;color:var(--text2)}
.wf-session-status{font-size:9px;padding:2px 6px;border-radius:8px;font-weight:600;text-transform:uppercase;flex-shrink:0}
.wf-session-status.ok{background:rgba(78,201,176,.15);color:var(--ok)}
.wf-session-status.err{background:rgba(244,71,71,.15);color:var(--err)}
.wf-session-status.run{background:rgba(0,122,204,.15);color:var(--accent2)}
.wf-session-status.queue{background:rgba(220,220,170,.15);color:var(--warn)}
.wf-session-actions{display:flex;gap:4px;flex-shrink:0}
.wf-session-actions button{padding:2px 6px;font-size:10px}

/* Step styling for Quick Generate */
.wf-step{margin-bottom:12px;padding:10px;background:rgba(255,255,255,.02);border-radius:6px;border:1px solid var(--border)}
.wf-step-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.wf-step-num{width:20px;height:20px;background:var(--accent);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0}
.wf-step-title{font-size:11px;font-weight:600;color:var(--text)}
.wf-file-name{font-size:10px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;flex-shrink:0}

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
      <!-- Step 1: Select OpenAPI File -->
      <div class="wf-step">
        <div class="wf-step-header">
          <span class="wf-step-num">1</span>
          <span class="wf-step-title">Select OpenAPI File</span>
        </div>
        <div class="wf-row" style="flex-direction:column;align-items:stretch;gap:6px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="radio" name="wf-source-mode" id="wf-source-existing" value="existing" checked onchange="onSourceModeChange()">
            <span style="font-size:11px">From existing API</span>
          </label>
          <div id="wf-existing-api-row" class="wf-row">
            <select class="wf-select" id="wf-api-select" style="flex:1" onchange="onExistingApiChange(this.value)">
              <option value="">-- Select API --</option>
            </select>
          </div>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:4px">
            <input type="radio" name="wf-source-mode" id="wf-source-file" value="file" onchange="onSourceModeChange()">
            <span style="font-size:11px">From local file</span>
          </label>
          <div id="wf-file-row" class="wf-row" style="display:none">
            <button class="btn-s" style="flex:1" onclick="pickOpenApiFile()">📁 Choose File...</button>
            <span class="wf-file-name" id="wf-file-name">No file selected</span>
          </div>
        </div>
      </div>

      <!-- Step 2: Prompt Enhancement -->
      <div class="wf-step">
        <div class="wf-step-header">
          <span class="wf-step-num">2</span>
          <span class="wf-step-title">Prompt Enhancement</span>
        </div>
        <div class="wf-row" style="flex-direction:column;align-items:stretch">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px">
            <input type="radio" name="wf-prompt-mode" id="wf-mode-skill" value="skill" checked onchange="onPromptModeChange()">
            <span style="font-size:11px">Use Skill: <strong>ui-ux-pro-max</strong></span>
            <span class="badge badge-ok" style="font-size:9px">Recommended</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px">
            <input type="radio" name="wf-prompt-mode" id="wf-mode-skill-custom" value="skill-custom" onchange="onPromptModeChange()">
            <span style="font-size:11px">Manual + Enhance</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="radio" name="wf-prompt-mode" id="wf-mode-manual" value="manual" onchange="onPromptModeChange()">
            <span style="font-size:11px">Manual only</span>
          </label>
        </div>
        <div class="wf-row" id="wf-skill-row" style="margin-top:6px">
          <select class="wf-select" id="wf-skill-select" style="flex:1">
            <option value="ui-ux-pro-max">UI/UX Pro Max (Default)</option>
            <option value="minimal-ui">Minimal UI</option>
            <option value="dashboard-pro">Dashboard Pro</option>
          </select>
        </div>
      </div>

      <!-- Step 3: Actions Configuration -->
      <div class="wf-step" id="wf-step-actions" style="display:none">
        <div class="wf-step-header">
          <span class="wf-step-num">3</span>
          <span class="wf-step-title">Actions Configuration</span>
        </div>
        <div class="wf-row" style="flex-direction:column;align-items:stretch">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px">
            <input type="radio" name="wf-actions-mode" id="wf-actions-auto" value="auto" checked>
            <span style="font-size:11px">Auto-detect from API</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="radio" name="wf-actions-mode" id="wf-actions-manual" value="manual">
            <span style="font-size:11px">Manual prompt</span>
          </label>
          <textarea id="wf-actions-prompt" rows="2" placeholder="e.g., 'CRUD for products with search and pagination'" style="width:100%;padding:6px;margin-top:6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:11px;resize:vertical;font-family:inherit;display:none"></textarea>
        </div>
      </div>

      <!-- Step 4: Design Configuration -->
      <div class="wf-step">
        <div class="wf-step-header">
          <span class="wf-step-num" id="wf-step-design-num">3</span>
          <span class="wf-step-title">Design Configuration</span>
        </div>
        <div class="wf-row" id="wf-design-templates" style="flex-direction:column;align-items:stretch">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px">
            <input type="radio" name="wf-design-mode" id="wf-design-modern" value="modern" checked>
            <span style="font-size:11px">Modern minimalist with subtle shadows</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px">
            <input type="radio" name="wf-design-mode" id="wf-design-dark" value="dark">
            <span style="font-size:11px">Dark mode with vibrant accents</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="radio" name="wf-design-mode" id="wf-design-custom" value="custom">
            <span style="font-size:11px">Custom</span>
          </label>
        </div>
        <textarea id="wf-design-prompt" rows="2" placeholder="e.g., 'Dark theme, blue accent, Tailwind CSS, mobile-first'" style="width:100%;padding:6px;margin-top:6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:11px;resize:vertical;font-family:inherit;display:none"></textarea>
      </div>

      <!-- Step 5: AI Provider -->
      <div class="wf-step">
        <div class="wf-step-header">
          <span class="wf-step-num" id="wf-step-provider-num">4</span>
          <span class="wf-step-title">AI Provider</span>
        </div>
        <div class="wf-row" style="gap:8px">
          <label style="font-size:11px;color:var(--text2);min-width:60px;flex-shrink:0">Provider:</label>
          <select class="wf-select" id="wf-provider-select" style="flex:1;min-width:0" onchange="onProviderChange(this.value)">
            <option value="gemini">Gemini</option>
            <option value="groq">Groq</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <div class="wf-row" style="margin-top:8px;gap:8px">
          <label style="font-size:11px;color:var(--text2);min-width:60px;flex-shrink:0">Model:</label>
          <select class="wf-select" id="wf-model-select" style="flex:1;min-width:0"></select>
        </div>
      </div>

      <!-- Generate Buttons -->
      <div class="wf-cta" style="margin-top:12px">
        <button class="btn-p" id="wf-btn-preview" onclick="generatePreview()" style="width:100%;padding:10px;font-size:13px">
          🚀 Generate Preview
        </button>
      </div>
      <div class="wf-meta" id="wf-status" style="text-align:center;margin-top:8px">Select an OpenAPI file to start</div>
    </div>
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
    : `<div style="padding:16px 10px;text-align:center;color:var(--text2)">Login to view your APIs.</div>`
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

/* ---- Provider/Model Configuration ---- */
const providerModels = {
  gemini: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Recommended)' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.0-flash-001', label: 'Gemini 2.0 Flash 001' },
    { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite' },
    { value: 'gemini-2.0-flash-lite-001', label: 'Gemini 2.0 Flash-Lite 001' },
  ],
  groq: [
    { value: 'llama-3.3-70b-versatile', label: 'LLaMA 3.3 70B Versatile (Recommended)' },
    { value: 'llama-3.1-70b-versatile', label: 'LLaMA 3.1 70B Versatile' },
    { value: 'llama-3.1-8b-instant', label: 'LLaMA 3.1 8B Instant' },
    { value: 'llama3-70b-8192', label: 'LLaMA 3 70B' },
    { value: 'llama3-8b-8192', label: 'LLaMA 3 8B' },
    { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
    { value: 'gemma2-9b-it', label: 'Gemma 2 9B' },
    { value: 'qwen-qwq-32b', label: 'Qwen QwQ 32B' },
    { value: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill LLaMA 70B' },
  ],
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o (Recommended)' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-4', label: 'GPT-4' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
};

function onProviderChange(provider) {
  const modelSelect = document.getElementById('wf-model-select');
  if (!modelSelect) return;
  const models = providerModels[provider] || [];
  modelSelect.innerHTML = models.map(m =>
    \`<option value="\${m.value}">\${esc(m.label)}</option>\`
  ).join('');
  console.log('[uigenai][workflow] Provider changed to', provider, '- loaded', models.length, 'models');
}

// Initialize model list on page load
(function initModels() {
  const providerSelect = document.getElementById('wf-provider-select');
  if (providerSelect) {
    onProviderChange(providerSelect.value);
  }
  // Init prompt mode change handlers
  onPromptModeChange();
  initDesignModeHandlers();
  initActionsModeHandlers();
  onSourceModeChange();
})();

/* ---- Workflow State ---- */
let wfSelectedFile = null;
let wfFileContent = null;
let wfSelectedApiId = null;

function onSourceModeChange() {
  const existingMode = document.getElementById('wf-source-existing')?.checked;
  const existingRow = document.getElementById('wf-existing-api-row');
  const fileRow = document.getElementById('wf-file-row');

  if (existingMode) {
    if (existingRow) existingRow.style.display = 'flex';
    if (fileRow) fileRow.style.display = 'none';
  } else {
    if (existingRow) existingRow.style.display = 'none';
    if (fileRow) fileRow.style.display = 'flex';
  }
}

function onExistingApiChange(apiId) {
  wfSelectedApiId = apiId || null;
  if (!apiId) {
    wfFileContent = null;
    updateWfStatus('Select an API or file to start', 'var(--text2)');
    return;
  }
  // Request OpenAPI document for this API
  updateWfStatus('Loading API document...', 'var(--accent2)');
  send('loadApiOpenApiDoc', { apiId });
}

function updateWfStatus(message, color) {
  const statusEl = document.getElementById('wf-status');
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.style.color = color || 'var(--text2)';
  }
}

function onPromptModeChange() {
  const skillMode = document.getElementById('wf-mode-skill')?.checked;
  const skillCustomMode = document.getElementById('wf-mode-skill-custom')?.checked;
  const manualMode = document.getElementById('wf-mode-manual')?.checked;

  const skillRow = document.getElementById('wf-skill-row');
  const actionsStep = document.getElementById('wf-step-actions');
  const designNum = document.getElementById('wf-step-design-num');
  const providerNum = document.getElementById('wf-step-provider-num');

  if (skillMode) {
    // Use Skill only - hide skill selector, hide actions step
    if (skillRow) skillRow.style.display = 'none';
    if (actionsStep) actionsStep.style.display = 'none';
    if (designNum) designNum.textContent = '3';
    if (providerNum) providerNum.textContent = '4';
  } else if (skillCustomMode) {
    // Manual + Enhance - show skill selector, show actions step
    if (skillRow) skillRow.style.display = 'flex';
    if (actionsStep) actionsStep.style.display = 'block';
    if (designNum) designNum.textContent = '4';
    if (providerNum) providerNum.textContent = '5';
  } else {
    // Manual only - hide skill selector, show actions step
    if (skillRow) skillRow.style.display = 'none';
    if (actionsStep) actionsStep.style.display = 'block';
    if (designNum) designNum.textContent = '4';
    if (providerNum) providerNum.textContent = '5';
  }
}

function initDesignModeHandlers() {
  const designCustom = document.getElementById('wf-design-custom');
  const designPrompt = document.getElementById('wf-design-prompt');
  const radios = document.querySelectorAll('input[name="wf-design-mode"]');

  radios.forEach(r => {
    r.addEventListener('change', () => {
      if (designPrompt) {
        designPrompt.style.display = designCustom?.checked ? 'block' : 'none';
      }
    });
  });
}

function initActionsModeHandlers() {
  const actionsManual = document.getElementById('wf-actions-manual');
  const actionsPrompt = document.getElementById('wf-actions-prompt');
  const radios = document.querySelectorAll('input[name="wf-actions-mode"]');

  radios.forEach(r => {
    r.addEventListener('change', () => {
      if (actionsPrompt) {
        actionsPrompt.style.display = actionsManual?.checked ? 'block' : 'none';
      }
    });
  });
}

function pickOpenApiFile() {
  send('pickOpenApiFile');
}

function setWfFile(filePath, content) {
  wfSelectedFile = filePath;
  wfFileContent = content;
  const nameEl = document.getElementById('wf-file-name');
  if (nameEl) {
    const shortName = filePath.split(/[\\\\/]/).pop() || filePath;
    nameEl.textContent = shortName;
    nameEl.title = filePath;
  }
  const statusEl = document.getElementById('wf-status');
  if (statusEl) {
    statusEl.textContent = 'Ready to generate!';
    statusEl.style.color = 'var(--ok)';
  }
}

function generatePreview() {
  if (!wfSelectedFile || !wfFileContent) {
    const statusEl = document.getElementById('wf-status');
    if (statusEl) {
      statusEl.textContent = 'Please select an OpenAPI file first';
      statusEl.style.color = 'var(--err)';
    }
    return;
  }

  // Get prompt mode
  const skillMode = document.getElementById('wf-mode-skill')?.checked;
  const skillCustomMode = document.getElementById('wf-mode-skill-custom')?.checked;

  const useSkill = skillMode || skillCustomMode;
  const skillName = document.getElementById('wf-skill-select')?.value || 'ui-ux-pro-max';

  // Get actions prompt (only if not pure skill mode)
  let actionsPrompt = '';
  if (!skillMode) {
    const actionsManual = document.getElementById('wf-actions-manual')?.checked;
    if (actionsManual) {
      actionsPrompt = document.getElementById('wf-actions-prompt')?.value?.trim() || '';
    }
  }

  // Get design configuration
  let designPrompt = '';
  const designMode = document.querySelector('input[name="wf-design-mode"]:checked')?.value;
  if (designMode === 'modern') {
    designPrompt = 'Modern minimalist design with subtle shadows, clean lines';
  } else if (designMode === 'dark') {
    designPrompt = 'Dark mode with vibrant accent colors, modern feel';
  } else if (designMode === 'custom') {
    designPrompt = document.getElementById('wf-design-prompt')?.value?.trim() || '';
  }

  const provider = document.getElementById('wf-provider-select')?.value || 'gemini';
  const model = document.getElementById('wf-model-select')?.value || 'gemini-2.5-flash';

  const statusEl = document.getElementById('wf-status');
  if (statusEl) {
    statusEl.textContent = 'Generating preview...';
    statusEl.style.color = 'var(--accent2)';
  }

  send('quickGenerate', {
    apiFilePath: wfSelectedFile,
    apiContent: wfFileContent,
    useSkill,
    skillName,
    actionsPrompt,
    designPrompt,
    provider,
    model,
  });
}

/* ---- Section toggle ---- */
function toggleSec(id) {
  const b = document.getElementById('body-' + id);
  const a = document.getElementById('arrow-' + id);
  const open = b.classList.toggle('open');
  a.classList.toggle('open', open);
  if (open) {
    if (id === 'apis') send('loadApis');
    if (id === 'workflow') send('loadApis');
  }
}

/* ---- Workflow helpers ---- */
function setWorkflowApis(apis) {
  workflowApis = apis || [];
  console.log('[uigenai][workflow] API list loaded', workflowApis.map(a => a.name));
  const sel = document.getElementById('wf-api-select');
  if (!sel) return;
  if (!workflowApis.length) {
    sel.innerHTML = '<option value="">No APIs yet</option>';
    selectedApiId = null;
    renderWorkflow(null);
    return;
  }
  sel.innerHTML = '<option value="">-- Select API --</option>' + workflowApis
    .map(a => \`<option value="\${a.id}">\${esc(a.name)}</option>\`)
    .join('');
  // Don't auto-select, let user choose
  sel.value = '';
  console.log('[uigenai][workflow] API dropdown populated with', workflowApis.length, 'APIs');
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
  const previewList = document.getElementById('wf-preview-list');
  const fullList = document.getElementById('wf-full-list');
  const previewCount = document.getElementById('wf-preview-count');
  const fullCount = document.getElementById('wf-full-count');

  console.log('[uigenai][workflow] renderWorkflow called with payload:', payload);

  if (!payload) {
    console.log('[uigenai][workflow] No payload - disabling all buttons');
    if (stateEl) {
      stateEl.textContent = "--";
      stateEl.className = "wf-badge info";
    }
    if (metaEl) metaEl.textContent = "Select an API to see actions.";
    [btnPreview, btnFull, btnReady].forEach((b) => {
      if (b) {
        b.disabled = true;
        b.title = "Select an API first.";
      }
    });
    if (previewList) previewList.innerHTML = '<div class="empty">No preview sessions yet.</div>';
    if (fullList) fullList.innerHTML = '<div class="empty">No full source sessions yet.</div>';
    if (previewCount) previewCount.textContent = '0';
    if (fullCount) fullCount.textContent = '0';
    workflowLatest = { preview: null, full: null };
    return;
  }

  if (selectedApiId && payload.api.id !== selectedApiId) {
    console.log('[uigenai][workflow] Ignoring stale payload for API:', payload.api.id, '(current:', selectedApiId, ')');
    return;
  }

  console.log('[uigenai][workflow] Processing workflow for API:', payload.api.name, 'state:', payload.api.workflow_state);

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

  if (btnPreview) {
    btnPreview.disabled = !previewReady;
    btnPreview.title = previewReady ? "Generate a UI preview for this API" : "Select an API first.";
  }
  if (btnFull) {
    btnFull.disabled = !fullReady;
    btnFull.title = fullReady
      ? "Generate full source code from the preview"
      : \`Disabled: \${!payload.preview ? 'No preview session exists' : 'Preview status is ' + payload.preview.status + ' (needs SUCCEEDED)'}\`;
  }
  if (btnReady) {
    btnReady.disabled = !markReadyReady;
    btnReady.title = markReadyReady ? "Mark this API as ready to deploy" : "Run a successful full source generation first";
  }

  // Render sessions lists
  const allPreview = payload.allPreviewSessions || [];
  const allFull = payload.allFullSessions || [];

  if (previewCount) previewCount.textContent = allPreview.length;
  if (fullCount) fullCount.textContent = allFull.length;

  if (previewList) {
    if (allPreview.length === 0) {
      previewList.innerHTML = '<div class="empty">No preview sessions yet.</div>';
    } else {
      previewList.innerHTML = allPreview.map(s => renderSessionItem(s, 'PREVIEW')).join('');
    }
  }

  if (fullList) {
    if (allFull.length === 0) {
      fullList.innerHTML = '<div class="empty">No full source sessions yet.</div>';
    } else {
      fullList.innerHTML = allFull.map(s => renderSessionItem(s, 'FULL_SOURCE')).join('');
    }
  }
}

function renderSessionItem(session, mode) {
  const statusClass = session.status === 'SUCCEEDED' ? 'ok'
    : session.status === 'FAILED' ? 'err'
    : session.status === 'RUNNING' ? 'run'
    : 'queue';
  const date = new Date(session.created_at).toLocaleString();
  const model = session.model || 'unknown';
  const provider = session.provider || 'unknown';
  const canReview = session.status === 'SUCCEEDED';

  return \`<div class="wf-session-item">
    <div class="wf-session-info">
      <div class="wf-session-model">\${esc(provider)} / \${esc(model)}</div>
      <div class="wf-session-date">\${esc(date)}</div>
    </div>
    <span class="wf-session-status \${statusClass}">\${esc(session.status)}</span>
    <div class="wf-session-actions">
      <button class="btn-s" onclick="reviewSession('\${session.id}', '\${mode}')" \${canReview ? '' : 'disabled'} title="\${canReview ? 'Review this session' : 'Session not completed'}">View</button>
      <button class="btn-d" onclick="deleteSession('\${session.id}')" title="Delete this session">Del</button>
    </div>
  </div>\`;
}

function setWorkflowMessage(msg) {
  const metaEl = document.getElementById('wf-meta');
  if (metaEl) metaEl.textContent = msg;
}

function getSelectedProvider() {
  const sel = document.getElementById('wf-provider-select');
  return sel ? sel.value : 'gemini';
}

function getSelectedModel() {
  const sel = document.getElementById('wf-model-select');
  return sel ? sel.value : 'gemini-2.5-flash';
}

function getCustomPrompt() {
  const el = document.getElementById('wf-custom-prompt');
  return el ? el.value.trim() : '';
}

function clickPreview() {
  console.log('[uigenai][workflow] Preview UI click', selectedApiId);
  if (!selectedApiId) {
    setWorkflowMessage("Select an API first.");
    return;
  }
  send('generatePreview', { apiId: selectedApiId, provider: getSelectedProvider(), model: getSelectedModel(), customPrompt: getCustomPrompt() });
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
  send('generateFull', { apiId: selectedApiId, provider: getSelectedProvider(), model: getSelectedModel(), customPrompt: getCustomPrompt() });
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

function reviewSession(sessionId, mode) {
  console.log('[uigenai][workflow] Review session click', sessionId, mode);
  if (!sessionId || !selectedApiId) {
    setWorkflowMessage("Select an API first.");
    return;
  }
  if (mode === 'PREVIEW') {
    send('reviewPreviewSession', { apiId: selectedApiId, sessionId: sessionId });
  } else {
    send('reviewFullSession', { apiId: selectedApiId, sessionId: sessionId });
  }
}

function deleteSession(sessionId) {
  console.log('[uigenai][workflow] Delete session click', sessionId);
  if (!sessionId || !selectedApiId) {
    setWorkflowMessage("Select an API first.");
    return;
  }
  send('deleteApiSession', { apiId: selectedApiId, sessionId: sessionId });
}

// Keep old functions for backward compatibility
function reviewPreview() {
  if (!workflowLatest.preview || workflowLatest.preview.status !== "SUCCEEDED") {
    setWorkflowMessage("No successful preview session to review.");
    return;
  }
  reviewSession(workflowLatest.preview.id, 'PREVIEW');
}
function reviewFull() {
  if (!workflowLatest.full || workflowLatest.full.status !== "SUCCEEDED") {
    setWorkflowMessage("No successful full-source session to review.");
    return;
  }
  reviewSession(workflowLatest.full.id, 'FULL_SOURCE');
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
        📄 Documents <button class="btn-icon" onclick="event.stopPropagation();showAddDocModal('\${a.id}')" title="Add Document">＋</button>
      </div>
      <div class="sub-body" id="adoc-\${a.id}"></div>

      <div class="sub-hd" onclick="toggleAdvanced('\${a.id}')" style="color:var(--text2);font-style:italic">
        ⚙️ Advanced <span class="arrow" id="adv-arrow-\${a.id}" style="font-size:8px">▶</span>
      </div>
      <div class="sub-body" id="aadv-\${a.id}">
        <div class="sub-hd" onclick="toggleApiSubSec('\${a.id}','configs')" style="padding-left:10px">
          Configs <button class="btn-icon" onclick="event.stopPropagation();send('createConfig',{apiId:'\${a.id}'})">＋</button>
        </div>
        <div class="sub-body" id="acfg-\${a.id}"></div>

        <div class="sub-hd" onclick="toggleApiSubSec('\${a.id}','schemas')" style="padding-left:10px">
          UI Schemas <button class="btn-icon" onclick="event.stopPropagation();send('createSchema',{apiId:'\${a.id}'})">＋</button>
        </div>
        <div class="sub-body" id="asch-\${a.id}"></div>

        <div class="sub-hd" onclick="toggleApiSubSec('\${a.id}','codes')" style="padding-left:10px">
          Generated Codes
        </div>
        <div class="sub-body" id="acod-\${a.id}"></div>

        <div class="sub-hd" onclick="toggleApiSubSec('\${a.id}','deployments')" style="padding-left:10px">
          Deployments <button class="btn-icon" onclick="event.stopPropagation();send('createDeployment',{apiId:'\${a.id}'})">＋</button>
        </div>
        <div class="sub-body" id="adep-\${a.id}"></div>
      </div>
    </div>
  \`).join('');
}

function toggleAdvanced(aid) {
  const el = document.getElementById('aadv-' + aid);
  const arrow = document.getElementById('adv-arrow-' + aid);
  const open = el.classList.toggle('open');
  if (arrow) arrow.textContent = open ? '▼' : '▶';
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
    case 'qgFileSelected':
      console.log('[uigenai][workflow] File selected:', data?.filePath);
      setWfFile(data.filePath, data.content);
      break;
    case 'qgStatus':
      console.log('[uigenai][workflow] Quick Generate status:', data);
      const statusEl = document.getElementById('qg-status');
      if (statusEl) {
        statusEl.textContent = data.message;
        statusEl.style.color = data.success ? 'var(--ok)' : 'var(--err)';
      }
      break;
    case 'apiOpenApiDoc':
      console.log('[uigenai][workflow] OpenAPI doc loaded for API:', data?.apiId);
      if (data?.content && wfSelectedApiId === data.apiId) {
        wfSelectedFile = data.name || 'openapi.yaml';
        wfFileContent = data.content;
        updateWfStatus('Ready to generate!', 'var(--ok)');
      }
      break;
    case 'apiOpenApiDocError':
      console.log('[uigenai][workflow] OpenAPI doc error:', data?.error);
      if (wfSelectedApiId === data?.apiId) {
        wfFileContent = null;
        updateWfStatus(data?.error || 'Failed to load API document', 'var(--err)');
      }
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
