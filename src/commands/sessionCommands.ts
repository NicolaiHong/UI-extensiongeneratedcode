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
      { label: "Gemini", value: "gemini" },
      { label: "OpenAI", value: "openai" },
    ],
    { title: "AI Provider" },
  );
  if (!provider) {
    return;
  }

  const model = await vscode.window.showInputBox({
    title: "Model",
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
    { title: "Framework" },
  );

  const css = await vscode.window.showQuickPick(
    [
      { label: "Tailwind CSS", value: "tailwind" },
      { label: "CSS Modules", value: "css-modules" },
      { label: "Styled Components", value: "styled-components" },
    ],
    { title: "CSS Strategy" },
  );

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Running generation session...",
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
          `Session started! Status: ${session.status}`,
        );
        vscode.commands.executeCommand("uigenai.refreshSidebar");
      } catch (e: unknown) {
        vscode.window.showErrorMessage(`Failed: ${extractApiError(e)}`);
      }
    },
  );
}
