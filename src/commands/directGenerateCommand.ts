/**
 * Flow 1 — Direct Generate (Swagger-first)
 *
 * User provides an OpenAPI/Swagger file directly.
 * Extension derives ENTITY_SCHEMA from components.schemas,
 * collects ACTION_SPEC (prompt) and DESIGN_SYSTEM (preset),
 * uploads all 4 documents, then runs a session via the existing backend.
 *
 * NO scan. NO inference. NO LLM fallback.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import { parseAndDerive } from "../utils/openApiUtils";
import {
  FRAMEWORKS,
  DESIGN_SYSTEMS,
  AI_PROVIDERS,
  buildDesignSystemContent,
} from "../utils/designPresets";
import { projectsApi, Project } from "../api/projects.api";
import { documentsApi } from "../api/documents.api";
import { sessionsApi } from "../api/sessions.api";
import { extractApiError } from "../utils/errors";

export async function directGenerateCmd(
  _context: vscode.ExtensionContext,
): Promise<void> {
  // ── 1. Pick project ──
  let projects: Project[] = [];
  try {
    projects = await projectsApi.list();
  } catch (e: unknown) {
    vscode.window.showErrorMessage(
      `Failed to fetch projects: ${extractApiError(e)}. Are you logged in?`,
    );
    return;
  }

  if (projects.length === 0) {
    const create = await vscode.window.showWarningMessage(
      "No projects found. Create one first?",
      "Create Project",
      "Cancel",
    );
    if (create === "Create Project") {
      await vscode.commands.executeCommand("uigenai.createProject");
    }
    return;
  }

  const projectPick = await vscode.window.showQuickPick(
    projects.map((p) => ({
      label: p.name,
      description: p.description || "",
      value: p.id,
    })),
    { title: "Direct Generate — Select Project", placeHolder: "Choose the target project" },
  );
  if (!projectPick) {
    return;
  }
  const projectId = projectPick.value;

  // ── 2. Pick OpenAPI file ──
  const fileUris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      "OpenAPI / Swagger": ["json", "yaml", "yml"],
    },
    title: "Select your OpenAPI / Swagger document",
  });
  if (!fileUris?.length) {
    return;
  }

  // ── 3. Read & validate ──
  let rawContent: string;
  try {
    rawContent = fs.readFileSync(fileUris[0].fsPath, "utf-8");
  } catch (e: any) {
    vscode.window.showErrorMessage(`Could not read file: ${e.message}`);
    return;
  }

  let openApiContent: string;
  let entitySchema: string;
  try {
    const result = parseAndDerive(rawContent);
    openApiContent = result.openApiContent;
    entitySchema = result.entitySchema;
  } catch (e: any) {
    vscode.window.showErrorMessage(`Invalid OpenAPI document: ${e.message}`);
    return;
  }

  // Show summary of what was derived
  const parsed = JSON.parse(entitySchema);
  const entityCount = parsed.entities?.length ?? 0;
  const proceed = await vscode.window.showInformationMessage(
    `✅ Valid OpenAPI document detected. Derived ${entityCount} entity schema(s) from components/definitions.`,
    "Continue",
    "Preview Schema",
    "Cancel",
  );

  if (proceed === "Preview Schema") {
    const doc = await vscode.workspace.openTextDocument({
      content: entitySchema,
      language: "json",
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    const cont = await vscode.window.showInformationMessage(
      "Review the derived schema. Continue with generation?",
      "Continue",
      "Cancel",
    );
    if (cont !== "Continue") {
      return;
    }
  } else if (proceed !== "Continue") {
    return;
  }

  // ── 4. ACTION_SPEC — user prompt ──
  const prompt = await vscode.window.showInputBox({
    title: "Direct Generate — What to build?",
    prompt: "Describe the UI / pages you want to generate (this becomes the ACTION_SPEC)",
    placeHolder:
      "e.g. Create a product management dashboard with CRUD table, search, and filters",
    ignoreFocusOut: true,
  });
  if (!prompt?.trim()) {
    return;
  }

  // ── 5. Design system preset ──
  const designPick = await vscode.window.showQuickPick(
    DESIGN_SYSTEMS.map((d) => ({ label: d.label, description: d.value, value: d })),
    { title: "Design System / CSS", placeHolder: "Select the design system preset" },
  );
  if (!designPick) {
    return;
  }
  const designContent = buildDesignSystemContent(designPick.value);
  const cssStrategy = designPick.value.cssStrategy;

  // ── 6. Framework ──
  const frameworkPick = await vscode.window.showQuickPick(
    FRAMEWORKS.map((f) => ({ label: f.label, description: f.value, value: f })),
    { title: "Framework", placeHolder: "Select the frontend framework" },
  );
  if (!frameworkPick) {
    return;
  }

  // ── 7. AI Provider + Model ──
  const providerPick = await vscode.window.showQuickPick(
    AI_PROVIDERS.map((p) => ({ label: p.label, value: p.value })),
    { title: "AI Provider" },
  );
  if (!providerPick) {
    return;
  }

  const cfg = vscode.workspace.getConfiguration("uigenai");
  const model = await vscode.window.showInputBox({
    title: "Model",
    value:
      providerPick.value === "gemini"
        ? cfg.get("defaultModel", "gemini-2.0-flash")
        : "gpt-4o",
  });
  if (!model) {
    return;
  }

  // ── 8. Upload all 4 documents + run session ──
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "🚀 Direct Generate",
      cancellable: false,
    },
    async (progress) => {
      try {
        // Upload OPENAPI
        progress.report({ message: "Uploading OpenAPI document..." });
        await documentsApi.upsert(projectId, "OPENAPI", {
          name: "OpenAPI Specification",
          content: openApiContent,
          content_type: "application/json",
        });

        // Upload ENTITY_SCHEMA
        progress.report({ message: "Uploading derived Entity Schema..." });
        await documentsApi.upsert(projectId, "ENTITY_SCHEMA", {
          name: "Entity Schema (derived from OpenAPI)",
          content: entitySchema,
          content_type: "application/json",
        });

        // Upload ACTION_SPEC
        progress.report({ message: "Uploading Action Spec..." });
        await documentsApi.upsert(projectId, "ACTION_SPEC", {
          name: "Action Specification",
          content: prompt.trim(),
          content_type: "text/plain",
        });

        // Upload DESIGN_SYSTEM
        progress.report({ message: "Uploading Design System..." });
        await documentsApi.upsert(projectId, "DESIGN_SYSTEM", {
          name: `Design System — ${designPick.value.label}`,
          content: designContent,
          content_type: "application/json",
        });

        // Run session
        progress.report({ message: "Starting generation session..." });
        const session = await sessionsApi.run(projectId, {
          provider: providerPick.value,
          model,
          framework: frameworkPick.value.sessionValue,
          cssStrategy,
        });

        // Poll for completion
        progress.report({ message: "Generating code — this may take a minute..." });
        const result = await pollSession(projectId, session.id);

        if (result.status === "SUCCEEDED") {
          vscode.window.showInformationMessage(
            `✅ Generation complete! ${result.output_summary_md ? "Check the output summary." : ""}`,
          );
          if (result.output_summary_md) {
            const doc = await vscode.workspace.openTextDocument({
              content: result.output_summary_md,
              language: "markdown",
            });
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
          }
        } else {
          vscode.window.showErrorMessage(
            `Generation failed: ${result.error_message || "Unknown error"}`,
          );
        }
      } catch (e: unknown) {
        vscode.window.showErrorMessage(
          `Direct Generate failed: ${extractApiError(e)}`,
        );
      }
    },
  );
}

// ── Polling helper ──

interface SessionStatus {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  error_message: string | null;
  output_summary_md: string | null;
}

async function pollSession(
  projectId: string,
  sessionId: string,
  maxWaitMs = 300_000,
  intervalMs = 3_000,
): Promise<SessionStatus> {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const session = await sessionsApi.getById(projectId, sessionId);

    if (session.status === "SUCCEEDED" || session.status === "FAILED") {
      return session;
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return {
    id: sessionId,
    status: "FAILED",
    error_message: "Timed out waiting for generation to complete.",
    output_summary_md: null,
  };
}
