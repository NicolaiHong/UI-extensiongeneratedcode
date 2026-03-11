import * as vscode from "vscode";
import { AuthManager } from "./auth/authManager";
import { showLoginWebview } from "./auth/loginWebview";
import { DashboardProvider } from "./sidebar/DashboardProvider";
import { initApiClient, getServerUrl } from "./api/client";
import { createProjectCmd } from "./commands/projectCommands";
import { createApiCmd } from "./commands/apiCommands";
import { uploadDocumentCmd } from "./commands/documentCommands";
import { inferFromFolderCmd } from "./commands/inferCommands";
import { runSessionCmd } from "./commands/sessionCommands";
import { createDeploymentCmd } from "./commands/deploymentCommands";
import { generateCmd } from "./commands/generateCommand";
import { directGenerateCmd } from "./commands/directGenerateCommand";
import { advancedGenerateCmd } from "./commands/advancedGenerateCommand";

let auth: AuthManager;

class OAuthCallbackHandler implements vscode.UriHandler {
  constructor(private _auth: AuthManager) {}
  async handleUri(uri: vscode.Uri): Promise<void> {
    if (uri.path === "/auth-callback") {
      const params = new URLSearchParams(uri.query);
      const accessToken = params.get("accessToken");
      const refreshToken = params.get("refreshToken");
      if (accessToken && refreshToken) {
        try {
          const user = await this._auth.loginWithTokens({
            accessToken,
            refreshToken,
          });
          vscode.window.showInformationMessage(
            `Welcome, ${user.displayName || user.email}! 🎉`,
          );
        } catch (e: any) {
          vscode.window.showErrorMessage(`OAuth login failed: ${e.message}`);
        }
      } else {
        vscode.window.showErrorMessage("OAuth callback missing tokens.");
      }
    }
  }
}

export async function activate(context: vscode.ExtensionContext) {
  /* ---- Auth ---- */
  auth = new AuthManager(context.secrets, context.globalState);
  await auth.init();

  /* ---- OAuth URI Handler ---- */
  context.subscriptions.push(
    vscode.window.registerUriHandler(new OAuthCallbackHandler(auth)),
  );

  /* ---- Dashboard sidebar ---- */
  const dashboardProvider = new DashboardProvider(context.extensionUri, auth);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DashboardProvider.viewType,
      dashboardProvider,
    ),
  );

  /* ---- Refresh dashboard on auth state change ---- */
  context.subscriptions.push(
    auth.onDidChange(() => dashboardProvider.refresh()),
  );

  /* ---- Commands ---- */
  const reg = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("uigenai.login", () => showLoginWebview(context.extensionUri, auth));
  reg("uigenai.logout", async () => {
    await auth.logout();
    vscode.window.showInformationMessage("Logged out.");
  });
  reg("uigenai.generate", () => generateCmd());
  reg("uigenai.setServer", async () => {
    const current = vscode.workspace
      .getConfiguration("uigenai")
      .get<string>("serverUrl", "http://localhost:3000");
    const url = await vscode.window.showInputBox({
      title: "Server URL",
      value: current,
      prompt: "Backend API URL",
    });
    if (url !== undefined) {
      await vscode.workspace
        .getConfiguration("uigenai")
        .update("serverUrl", url, vscode.ConfigurationTarget.Global);
      // Reset API client so it picks up newly configured URL
      initApiClient({
        getToken: async () => context.secrets.get("uigenai.accessToken"),
        onAuthFailed: () => auth.logout(),
      });
      dashboardProvider.refresh();
      vscode.window.showInformationMessage(`Server URL set to ${url}`);
    }
  });
  reg("uigenai.createProject", () => createProjectCmd());
  reg("uigenai.createApi", () => createApiCmd());
  reg("uigenai.uploadDocument", (projectId?: string) =>
    uploadDocumentCmd(projectId),
  );
  reg("uigenai.inferFromFolder", (projectId?: string) =>
    inferFromFolderCmd(projectId),
  );
  reg("uigenai.runSession", (projectId?: string) => runSessionCmd(projectId));
  reg("uigenai.createDeployment", () => createDeploymentCmd());
  reg("uigenai.directGenerate", () => directGenerateCmd(context));
  reg("uigenai.advancedGenerate", () => advancedGenerateCmd(context));
  reg("uigenai.refreshSidebar", () => dashboardProvider.refresh());
}

export function deactivate() {
  auth?.dispose();
}
