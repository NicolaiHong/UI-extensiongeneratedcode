import * as vscode from "vscode";
import { apiConfigsApi } from "../api/apiConfigs.api";

export async function createApiConfigCmd(apiId: string) {
  const key = await vscode.window.showInputBox({
    title: "Create Config",
    prompt: "Config key",
    placeHolder: "API_KEY",
  });
  if (!key) {
    return;
  }

  const value = await vscode.window.showInputBox({
    title: "Create Config",
    prompt: "Config value",
    placeHolder: "sk-...",
    password: false,
  });
  if (value === undefined) {
    return;
  }

  const secretPick = await vscode.window.showQuickPick(
    [
      { label: "No", value: false },
      { label: "Yes", value: true },
    ],
    { title: "Is this a secret?" },
  );

  try {
    const c = await apiConfigsApi.create(apiId, {
      key,
      value,
      is_secret: secretPick?.value ?? false,
    });
    vscode.window.showInformationMessage(`Config "${c.key}" created!`);
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: any) {
    vscode.window.showErrorMessage(
      `Failed: ${e.response?.data?.error?.message || e.message}`,
    );
  }
}

export async function editApiConfigCmd(apiId: string, configId: string) {
  try {
    const cfg = await apiConfigsApi.getById(apiId, configId);
    const key = await vscode.window.showInputBox({
      title: "Edit Config",
      value: cfg.key,
      prompt: "Config key",
    });
    if (!key) {
      return;
    }

    const value = await vscode.window.showInputBox({
      title: "Edit Config",
      value: cfg.is_secret ? "" : cfg.value,
      prompt: cfg.is_secret
        ? "Enter new value (current is hidden)"
        : "Config value",
    });
    if (value === undefined) {
      return;
    }

    const secretPick = await vscode.window.showQuickPick(
      [
        { label: "No", value: false },
        { label: "Yes", value: true },
      ],
      {
        title: "Is this a secret?",
        placeHolder: cfg.is_secret ? "Currently: Yes" : "Currently: No",
      },
    );

    await apiConfigsApi.update(apiId, configId, {
      key,
      value,
      is_secret: secretPick?.value ?? cfg.is_secret,
    });
    vscode.window.showInformationMessage(`Config updated!`);
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: any) {
    vscode.window.showErrorMessage(
      `Failed: ${e.response?.data?.error?.message || e.message}`,
    );
  }
}

export async function deleteApiConfigCmd(apiId: string, configId: string) {
  const confirm = await vscode.window.showWarningMessage(
    "Delete this config?",
    { modal: true },
    "Delete",
  );
  if (confirm !== "Delete") {
    return;
  }
  try {
    await apiConfigsApi.delete(apiId, configId);
    vscode.window.showInformationMessage("Config deleted.");
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: any) {
    vscode.window.showErrorMessage(
      `Failed: ${e.response?.data?.error?.message || e.message}`,
    );
  }
}
