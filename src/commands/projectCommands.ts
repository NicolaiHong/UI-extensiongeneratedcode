import * as vscode from "vscode";
import { projectsApi } from "../api/projects.api";

export async function createProjectCmd() {
  const name = await vscode.window.showInputBox({ title: "Create Project", prompt: "Project name", placeHolder: "My Awesome App" });
  if (!name) { return; }
  const desc = await vscode.window.showInputBox({ title: "Create Project", prompt: "Description (optional)", placeHolder: "An AI-powered app" });
  try {
    const p = await projectsApi.create({ name, description: desc || undefined });
    vscode.window.showInformationMessage(`Project "${p.name}" created!`);
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed: ${e.response?.data?.error?.message || e.message}`);
  }
}

export async function editProjectCmd(projectId: string) {
  const p = await projectsApi.getById(projectId);
  const name = await vscode.window.showInputBox({ title: "Edit Project", value: p.name, prompt: "Project name" });
  if (!name) { return; }
  const desc = await vscode.window.showInputBox({ title: "Edit Project", value: p.description || "", prompt: "Description" });
  try {
    await projectsApi.update(projectId, { name, description: desc || undefined });
    vscode.window.showInformationMessage(`Project updated!`);
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed: ${e.response?.data?.error?.message || e.message}`);
  }
}

export async function deleteProjectCmd(projectId: string, projectName: string) {
  const confirm = await vscode.window.showWarningMessage(`Delete project "${projectName}"?`, { modal: true }, "Delete");
  if (confirm !== "Delete") { return; }
  try {
    await projectsApi.delete(projectId);
    vscode.window.showInformationMessage(`Project deleted.`);
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed: ${e.response?.data?.error?.message || e.message}`);
  }
}
