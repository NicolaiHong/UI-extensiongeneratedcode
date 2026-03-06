import * as vscode from "vscode";
import { documentsApi, DocumentType } from "../api/documents.api";

const DOC_TYPES: { label: string; value: DocumentType }[] = [
  { label: "OpenAPI Spec", value: "OPENAPI" },
  { label: "Entity Schema", value: "ENTITY_SCHEMA" },
  { label: "Action Spec", value: "ACTION_SPEC" },
  { label: "Design System", value: "DESIGN_SYSTEM" },
];

export async function uploadDocumentCmd(projectId?: string) {
  if (!projectId) {
    vscode.window.showErrorMessage("Please select a project first.");
    return;
  }

  const typePick = await vscode.window.showQuickPick(DOC_TYPES, { title: "Document Type", placeHolder: "Select document type" });
  if (!typePick) { return; }

  // Option: paste content or pick file
  const source = await vscode.window.showQuickPick(
    [{ label: "📄 From current editor", value: "editor" }, { label: "📁 From file", value: "file" }, { label: "✏️ Paste content", value: "paste" }],
    { title: "Content Source" }
  );
  if (!source) { return; }

  let content = "";
  let name = typePick.label;

  if (source.value === "editor") {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showErrorMessage("No active editor"); return; }
    content = editor.document.getText();
    name = editor.document.fileName.split(/[/\\]/).pop() || name;
  } else if (source.value === "file") {
    const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { "All Files": ["*"] } });
    if (!files || files.length === 0) { return; }
    const buf = await vscode.workspace.fs.readFile(files[0]);
    content = Buffer.from(buf).toString("utf-8");
    name = files[0].path.split("/").pop() || name;
  } else {
    const pasted = await vscode.window.showInputBox({ title: "Paste content", prompt: "Paste document content (JSON/YAML)", ignoreFocusOut: true });
    if (!pasted) { return; }
    content = pasted;
  }

  try {
    await documentsApi.upsert(projectId, typePick.value, { name, content });
    vscode.window.showInformationMessage(`Document "${typePick.label}" uploaded!`);
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed: ${e.response?.data?.error?.message || e.message}`);
  }
}
