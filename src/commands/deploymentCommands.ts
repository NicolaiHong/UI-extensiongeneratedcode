import * as vscode from "vscode";
import { deploymentsApi } from "../api/deployments.api";
import { apisApi } from "../api/apis.api";
import { extractApiError } from "../utils/errors";

export async function createDeploymentCmd() {
  let apis;
  try {
    apis = await apisApi.list();
  } catch (e: unknown) {
    vscode.window.showErrorMessage(
      `Failed to load APIs: ${extractApiError(e)}`,
    );
    return;
  }
  if (!apis.length) {
    vscode.window.showWarningMessage("No APIs found. Create an API first.");
    return;
  }

  const apiPick = await vscode.window.showQuickPick(
    apis.map((a) => ({ label: a.name, value: a.id })),
    { title: "Select API for deployment" },
  );
  if (!apiPick) {
    return;
  }

  const env = await vscode.window.showQuickPick(
    [
      { label: "Development", value: "DEVELOPMENT" },
      { label: "Staging", value: "STAGING" },
      { label: "Production", value: "PRODUCTION" },
    ],
    { title: "Environment" },
  );
  if (!env) {
    return;
  }

  const provider = await vscode.window.showInputBox({
    title: "Provider (optional)",
    placeHolder: "vercel, netlify, etc.",
  });

  try {
    const d = await deploymentsApi.create(apiPick.value, {
      environment: env.value,
      provider: provider || undefined,
    });
    vscode.window.showInformationMessage(
      `Deployment created! Status: ${d.status}`,
    );
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Failed: ${extractApiError(e)}`);
  }
}

export async function updateDeploymentStatusCmd(
  apiId: string,
  deploymentId: string,
) {
  const status = await vscode.window.showQuickPick(
    ["PENDING", "IN_PROGRESS", "DEPLOYED", "FAILED", "ROLLED_BACK"].map(
      (s) => ({ label: s, value: s }),
    ),
    { title: "Update Status" },
  );
  if (!status) {
    return;
  }

  try {
    await deploymentsApi.update(apiId, deploymentId, {
      status: status.value as any,
    });
    vscode.window.showInformationMessage(
      `Deployment status updated to ${status.value}`,
    );
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Failed: ${extractApiError(e)}`);
  }
}
