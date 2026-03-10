import * as vscode from "vscode";
import { apisApi } from "../api/apis.api";
import { extractApiError } from "../utils/errors";

export async function createApiCmd() {
  const name = await vscode.window.showInputBox({
    title: "Create API",
    prompt: "API name",
    placeHolder: "User Management API",
  });
  if (!name) {
    return;
  }
  const desc = await vscode.window.showInputBox({
    title: "Create API",
    prompt: "Description (optional)",
  });
  const baseUrl = await vscode.window.showInputBox({
    title: "Create API",
    prompt: "Base URL (optional)",
    placeHolder: "https://api.example.com/v1",
  });
  try {
    const a = await apisApi.create({
      name,
      description: desc || undefined,
      base_url: baseUrl || undefined,
    });
    vscode.window.showInformationMessage(`API "${a.name}" created!`);
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Failed: ${extractApiError(e)}`);
  }
}

export async function editApiCmd(apiId: string) {
  const a = await apisApi.getById(apiId);
  const name = await vscode.window.showInputBox({
    title: "Edit API",
    value: a.name,
  });
  if (!name) {
    return;
  }
  const desc = await vscode.window.showInputBox({
    title: "Edit API",
    value: a.description || "",
  });
  const baseUrl = await vscode.window.showInputBox({
    title: "Edit API",
    value: a.base_url || "",
  });
  try {
    await apisApi.update(apiId, {
      name,
      description: desc || undefined,
      base_url: baseUrl || undefined,
    });
    vscode.window.showInformationMessage(`API updated!`);
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Failed: ${extractApiError(e)}`);
  }
}

export async function deleteApiCmd(apiId: string, apiName: string) {
  const c = await vscode.window.showWarningMessage(
    `Delete API "${apiName}"?`,
    { modal: true },
    "Delete",
  );
  if (c !== "Delete") {
    return;
  }
  try {
    await apisApi.delete(apiId);
    vscode.window.showInformationMessage(`API deleted.`);
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Failed: ${extractApiError(e)}`);
  }
}
