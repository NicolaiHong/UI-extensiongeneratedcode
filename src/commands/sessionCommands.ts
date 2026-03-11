import * as vscode from "vscode";
import { sessionsApi } from "../api/sessions.api";
import { extractApiError } from "../utils/errors";

export async function runSessionCmd(projectId?: string) {
  if (!projectId) {
    vscode.window.showErrorMessage("Please select a project first.");
    return;
  }

  const provider = await vscode.window.showQuickPick(
    [
      { label: "Gemini", description: "Google AI", value: "gemini" },
      { label: "OpenAI", description: "OpenAI API", value: "openai" },
    ],
    { title: "Run Session — AI Provider", placeHolder: "Choose the AI provider" },
  );
  if (!provider) {
    return;
  }

  const model = await vscode.window.showInputBox({
    title: "Run Session — Model",
    prompt: `Enter the model name for ${provider.label}`,
    placeHolder: "e.g. gemini-2.0-flash or gpt-4o",
    value: provider.value === "gemini" ? "gemini-2.0-flash" : "gpt-4o",
  });
  if (!model) {
    return;
  }

  const framework = await vscode.window.showQuickPick(
    [
      { label: "React", value: "react" },
      { label: "Vue", value: "vue" },
      { label: "Angular", value: "angular" },
    ],
    { title: "Run Session — Framework", placeHolder: "Choose the frontend framework" },
  );

  const css = await vscode.window.showQuickPick(
    [
      { label: "Tailwind CSS", value: "tailwind" },
      { label: "CSS Modules", value: "css-modules" },
      { label: "Styled Components", value: "styled-components" },
    ],
    { title: "Run Session — CSS Strategy", placeHolder: "Choose how styles are applied" },
  );

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Run Session — Running generation...",
    },
    async () => {
      try {
        const session = await sessionsApi.run(projectId, {
          provider: provider.value,
          model,
          framework: framework?.value,
          cssStrategy: css?.value,
        });
        vscode.window.showInformationMessage(
          `Session started. Status: ${session.status}`,
        );
        vscode.commands.executeCommand("uigenai.refreshSidebar");
      } catch (e: unknown) {
        const errMsg = extractApiError(e);

        // If the error indicates missing inferrable documents, offer recovery
        if (isMissingDocError(errMsg)) {
          const action = await vscode.window.showWarningMessage(
            `${errMsg}\n\nWould you like to infer the missing documents from a local folder?`,
            "Infer from Folder",
            "Cancel",
          );
          if (action === "Infer from Folder") {
            vscode.commands.executeCommand(
              "uigenai.inferFromFolder",
              projectId,
            );
          }
        } else {
          vscode.window.showErrorMessage(`Failed: ${errMsg}`);
        }
      }
    },
  );
}

/** Check if the error message indicates missing OPENAPI or ENTITY_SCHEMA */
function isMissingDocError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    (lower.includes("missing") || lower.includes("required")) &&
    (lower.includes("document") ||
      lower.includes("openapi") ||
      lower.includes("entity"))
  );
}
