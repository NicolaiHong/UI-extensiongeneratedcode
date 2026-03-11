import * as vscode from "vscode";
import { projectsApi } from "../api/projects.api";
import { extractApiError } from "../utils/errors";

export async function createProjectCmd() {
  const name = await vscode.window.showInputBox({
    title: "Create Project — Name",
    prompt: "Enter a name for the new project",
    placeHolder: "My Awesome App",
    validateInput: (v) => (v.trim() ? null : "Project name is required"),
  });
  if (!name?.trim()) {
    return;
  }
  const desc = await vscode.window.showInputBox({
    title: "Create Project — Description",
    prompt: "A short description (optional)",
    placeHolder: "An AI-powered app",
  });
  try {
    const p = await projectsApi.create({
      name,
      description: desc || undefined,
    });
    vscode.window.showInformationMessage(`Project "${p.name}" created.`);
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Failed: ${extractApiError(e)}`);
  }
}

export async function editProjectCmd(projectId: string) {
  const p = await projectsApi.getById(projectId);
  const name = await vscode.window.showInputBox({
    title: "Edit Project — Name",
    value: p.name,
    prompt: "Update the project name",
    validateInput: (v) => (v.trim() ? null : "Project name is required"),
  });
  if (!name) {
    return;
  }
  const desc = await vscode.window.showInputBox({
    title: "Edit Project — Description",
    value: p.description || "",
    prompt: "Update the description (optional)",
  });
  try {
    await projectsApi.update(projectId, {
      name,
      description: desc || undefined,
    });
    vscode.window.showInformationMessage(`Project updated.`);
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Failed: ${extractApiError(e)}`);
  }
}

export async function deleteProjectCmd(projectId: string, projectName: string) {
  const confirm = await vscode.window.showWarningMessage(
    `Delete project "${projectName}"? This action cannot be undone.`,
    { modal: true },
    "Delete",
  );
  if (confirm !== "Delete") {
    return;
  }
  try {
    await projectsApi.delete(projectId);
    vscode.window.showInformationMessage(`Project deleted.`);
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Failed: ${extractApiError(e)}`);
  }
}
