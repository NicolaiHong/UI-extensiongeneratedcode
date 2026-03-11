/**
 * Lightweight, reusable UI helpers for the generation flows.
 * These are thin wrappers around VS Code QuickPick / InputBox
 * that enforce a consistent look-and-feel. No logic changes.
 */

import * as vscode from "vscode";
import { projectsApi, Project } from "../api/projects.api";
import { extractApiError } from "./errors";
import {
  FRAMEWORKS,
  DESIGN_SYSTEMS,
  AI_PROVIDERS,
  buildDesignSystemContent,
} from "./designPresets";

// Types

export interface ProjectChoice {
  id: string;
  name: string;
}

export interface DesignChoice {
  label: string;
  content: string;
  cssStrategy: string;
}

export interface FrameworkChoice {
  label: string;
  value: string;
  sessionValue: string;
}

export interface ProviderModelChoice {
  provider: string;
  model: string;
}

//  Project Picker 

export async function pickProject(
  stepLabel: string,
): Promise<ProjectChoice | undefined> {
  let projects: Project[] = [];
  try {
    projects = await projectsApi.list();
  } catch (e: unknown) {
    vscode.window.showErrorMessage(
      `Could not load projects: ${extractApiError(e)}`,
    );
    return undefined;
  }

  if (projects.length === 0) {
    const action = await vscode.window.showWarningMessage(
      "No projects found. Create one first?",
      "Create Project",
      "Cancel",
    );
    if (action === "Create Project") {
      await vscode.commands.executeCommand("uigenai.createProject");
    }
    return undefined;
  }

  const pick = await vscode.window.showQuickPick(
    projects.map((p) => ({
      label: p.name,
      description: p.description || "",
      detail: `ID: ${p.id}`,
      value: p,
    })),
    {
      title: stepLabel,
      placeHolder: `${projects.length} project(s) available`,
    },
  );

  return pick ? { id: pick.value.id, name: pick.value.name } : undefined;
}

//  Framework Picker 

export async function pickFramework(
  stepLabel: string,
): Promise<FrameworkChoice | undefined> {
  const pick = await vscode.window.showQuickPick(
    FRAMEWORKS.map((f) => ({
      label: f.label,
      description: f.value,
      value: f,
    })),
    {
      title: stepLabel,
      placeHolder: "Choose a frontend framework",
    },
  );

  return pick
    ? { label: pick.value.label, value: pick.value.value, sessionValue: pick.value.sessionValue }
    : undefined;
}

//Design System Picker 

export async function pickDesignSystem(
  stepLabel: string,
): Promise<DesignChoice | undefined> {
  const pick = await vscode.window.showQuickPick(
    DESIGN_SYSTEMS.map((d) => ({
      label: d.label,
      description: d.cssStrategy === "tailwind" ? "Tailwind" : d.cssStrategy === "css-modules" ? "CSS Modules" : d.cssStrategy,
      value: d,
    })),
    {
      title: stepLabel,
      placeHolder: "Choose a design system or CSS framework",
    },
  );

  if (!pick) {
    return undefined;
  }

  return {
    label: pick.value.label,
    content: buildDesignSystemContent(pick.value),
    cssStrategy: pick.value.cssStrategy,
  };
}

// AI Provider + Model Picker 

export async function pickProviderAndModel(
  stepLabel: string,
): Promise<ProviderModelChoice | undefined> {
  const providerPick = await vscode.window.showQuickPick(
    AI_PROVIDERS.map((p) => ({
      label: p.label,
      description: p.value === "gemini" ? "Google AI" : "OpenAI API",
      value: p.value,
    })),
    {
      title: stepLabel,
      placeHolder: "Choose the AI provider",
    },
  );
  if (!providerPick) {
    return undefined;
  }

  const cfg = vscode.workspace.getConfiguration("uigenai");
  const defaultModel =
    providerPick.value === "gemini"
      ? cfg.get("defaultModel", "gemini-2.0-flash")
      : "gpt-4o";

  const model = await vscode.window.showInputBox({
    title: `${stepLabel} — Model`,
    prompt: `Enter the model name for ${providerPick.label}`,
    value: defaultModel as string,
    placeHolder: "e.g. gemini-2.0-flash or gpt-4o",
  });
  if (!model) {
    return undefined;
  }

  return { provider: providerPick.value, model };
}

// Pre-flight Summary 

export async function confirmGeneration(lines: string[]): Promise<boolean> {
  const summary = lines.join("\n");
  const action = await vscode.window.showInformationMessage(
    summary,
    { modal: true },
    "Generate",
  );
  return action === "Generate";
}

// Result Handler 

export async function showSessionResult(result: {
  status: string;
  error_message?: string | null;
  output_summary_md?: string | null;
}): Promise<void> {
  if (result.status === "SUCCEEDED") {
    const action = await vscode.window.showInformationMessage(
      "Generation succeeded — your code is ready.",
      "View Output",
      "Close",
    );
    if (action === "View Output" && result.output_summary_md) {
      const doc = await vscode.workspace.openTextDocument({
        content: result.output_summary_md,
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }
  } else {
    const errText = result.error_message || "Unknown error";
    await vscode.window.showErrorMessage(
      `Generation failed: ${errText}`,
      "Close",
    );
  }
}
