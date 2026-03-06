import * as vscode from "vscode";
import { uiSchemasApi } from "../api/uiSchemas.api";

export async function createUiSchemaCmd(apiId: string) {
  const name = await vscode.window.showInputBox({
    title: "Create UI Schema",
    prompt: "Schema name",
    placeHolder: "UserForm Schema",
  });
  if (!name) {
    return;
  }

  const source = await vscode.window.showQuickPick(
    [
      { label: "✏️ Paste JSON", value: "paste" },
      { label: "📄 From current editor", value: "editor" },
      { label: "📁 From file", value: "file" },
    ],
    { title: "Schema JSON source" },
  );
  if (!source) {
    return;
  }

  let json: any;
  if (source.value === "editor") {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("No active editor");
      return;
    }
    try {
      json = JSON.parse(editor.document.getText());
    } catch {
      vscode.window.showErrorMessage("Editor content is not valid JSON");
      return;
    }
  } else if (source.value === "file") {
    const files = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { JSON: ["json"] },
    });
    if (!files?.length) {
      return;
    }
    const buf = await vscode.workspace.fs.readFile(files[0]);
    try {
      json = JSON.parse(Buffer.from(buf).toString("utf-8"));
    } catch {
      vscode.window.showErrorMessage("File is not valid JSON");
      return;
    }
  } else {
    const raw = await vscode.window.showInputBox({
      title: "Schema JSON",
      prompt: "Paste JSON content",
      ignoreFocusOut: true,
    });
    if (!raw) {
      return;
    }
    try {
      json = JSON.parse(raw);
    } catch {
      vscode.window.showErrorMessage("Invalid JSON");
      return;
    }
  }

  try {
    const s = await uiSchemasApi.create(apiId, { name, schema_json: json });
    vscode.window.showInformationMessage(`UI Schema "${s.name}" created!`);
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: any) {
    vscode.window.showErrorMessage(
      `Failed: ${e.response?.data?.error?.message || e.message}`,
    );
  }
}

export async function editUiSchemaCmd(apiId: string, schemaId: string) {
  try {
    const schema = await uiSchemasApi.getById(apiId, schemaId);
    const name = await vscode.window.showInputBox({
      title: "Edit UI Schema",
      value: schema.name,
      prompt: "Schema name",
    });
    if (!name) {
      return;
    }

    const doc = await vscode.workspace.openTextDocument({
      content: JSON.stringify(schema.schema_json, null, 2),
      language: "json",
    });
    const editor = await vscode.window.showTextDocument(doc);

    const saved = await vscode.window.showInformationMessage(
      "Edit the JSON, then click Save to update.",
      { modal: false },
      "Save",
    );
    if (saved !== "Save") {
      return;
    }

    let json: any;
    try {
      json = JSON.parse(editor.document.getText());
    } catch {
      vscode.window.showErrorMessage("Document is not valid JSON");
      return;
    }

    await uiSchemasApi.update(apiId, schemaId, { name, schema_json: json });
    vscode.window.showInformationMessage(`UI Schema updated!`);
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: any) {
    vscode.window.showErrorMessage(
      `Failed: ${e.response?.data?.error?.message || e.message}`,
    );
  }
}

export async function deleteUiSchemaCmd(apiId: string, schemaId: string) {
  const confirm = await vscode.window.showWarningMessage(
    "Delete this UI Schema?",
    { modal: true },
    "Delete",
  );
  if (confirm !== "Delete") {
    return;
  }
  try {
    await uiSchemasApi.delete(apiId, schemaId);
    vscode.window.showInformationMessage("UI Schema deleted.");
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: any) {
    vscode.window.showErrorMessage(
      `Failed: ${e.response?.data?.error?.message || e.message}`,
    );
  }
}
