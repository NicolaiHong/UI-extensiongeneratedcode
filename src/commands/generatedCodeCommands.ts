import * as vscode from "vscode";
import { generatedCodesApi, GeneratedCode } from "../api/generatedCodes.api";

export async function viewGeneratedCodeCmd(apiId: string, codeId: string) {
  try {
    const code = await generatedCodesApi.getById(apiId, codeId);
    const doc = await vscode.workspace.openTextDocument({ content: code.content, language: code.language || "typescript" });
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed: ${e.response?.data?.error?.message || e.message}`);
  }
}

export async function applyGeneratedCodeCmd(apiId: string, codeId: string) {
  try {
    const code = await generatedCodesApi.getById(apiId, codeId);
    const wf = vscode.workspace.workspaceFolders;
    if (!wf?.length) { vscode.window.showErrorMessage("Open a workspace first"); return; }

    const uri = vscode.Uri.joinPath(wf[0].uri, code.file_path.replace(/^\/+/, ""));
    try { await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, "..")); } catch {}
    await vscode.workspace.fs.writeFile(uri, Buffer.from(code.content, "utf-8"));
    vscode.window.showInformationMessage(`Applied: ${code.file_path}`);

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed: ${e.response?.data?.error?.message || e.message}`);
  }
}

export async function deleteGeneratedCodeCmd(apiId: string, codeId: string) {
  const c = await vscode.window.showWarningMessage("Delete this generated code?", { modal: true }, "Delete");
  if (c !== "Delete") { return; }
  try {
    await generatedCodesApi.delete(apiId, codeId);
    vscode.window.showInformationMessage("Code deleted.");
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed: ${e.response?.data?.error?.message || e.message}`);
  }
}
