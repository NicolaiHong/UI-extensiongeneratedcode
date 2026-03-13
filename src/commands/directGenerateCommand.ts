import * as vscode from "vscode";
import * as fs from "fs";
import { parseAndDerive } from "../utils/openApiUtils";
import { documentsApi } from "../api/documents.api";
import { sessionsApi } from "../api/sessions.api";
import { extractApiError } from "../utils/errors";
import {
  pickProject,
  pickFramework,
  pickDesignSystem,
  pickProviderAndModel,
  confirmGeneration,
  showSessionResult,
} from "../utils/uxHelpers";

const FLOW_NAME = "From OpenAPI";

export async function directGenerateCmd(
  _context: vscode.ExtensionContext,
): Promise<void> {
  // Pick project
  const project = await pickProject(
    `${FLOW_NAME} \u2014 Step 1 of 6: Select Project`,
  );
  if (!project) {
    return;
  }

  // Pick OpenAPI file
  const fileUris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      "OpenAPI / Swagger": ["json", "yaml", "yml"],
    },
    title: `${FLOW_NAME} \u2014 Step 2 of 6: Select Swagger / OpenAPI File`,
  });
  if (!fileUris?.length) {
    return;
  }

  //  Read & validate
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
    `OpenAPI validated \u2014 ${entityCount} entity schema(s) derived.`,
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

  // ACTION_SPEC — user prompt
  const prompt = await vscode.window.showInputBox({
    title: `${FLOW_NAME} \u2014 Step 3 of 6: Describe What to Generate`,
    prompt: "Describe the UI you want to generate",
    placeHolder:
      "e.g. Create a product management dashboard with CRUD table, search, and filters",
    ignoreFocusOut: true,
  });
  if (!prompt?.trim()) {
    return;
  }

  // Design system preset
  const design = await pickDesignSystem(
    `${FLOW_NAME} \u2014 Step 4 of 6: Design System`,
  );
  if (!design) {
    return;
  }

  // Framework
  const framework = await pickFramework(
    `${FLOW_NAME} \u2014 Step 5 of 6: Framework`,
  );
  if (!framework) {
    return;
  }

  // AI Provider + Model
  const providerModel = await pickProviderAndModel(
    `${FLOW_NAME} \u2014 Step 6 of 6: AI Provider`,
  );
  if (!providerModel) {
    return;
  }

  // Pre-flight confirmation
  const fileName = fileUris[0].fsPath.split(/[\\/]/).pop();
  const confirmed = await confirmGeneration([
    `Project: ${project.name}`,
    ``,
    `Documents to upload:`,
    `  OPENAPI: ${fileName} (${entityCount} entities)`,
    `  ENTITY_SCHEMA: derived from OpenAPI`,
    `  ACTION_SPEC: from prompt`,
    `  DESIGN_SYSTEM: ${design.label}`,
    ``,
    `Prompt: "${prompt.trim().slice(0, 80)}${prompt.trim().length > 80 ? "..." : ""}"`,
    `Stack: ${framework.label} + ${design.label}`,
    `Provider: ${providerModel.provider} / ${providerModel.model}`,
  ]);
  if (!confirmed) {
    return;
  }

  // Upload all 4 documents + run session
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: FLOW_NAME,
      cancellable: false,
    },
    async (progress) => {
      try {
        progress.report({
          message: "[1/5] Uploading OpenAPI specification...",
        });
        await documentsApi.upsert(projectId(), "OPENAPI", {
          name: "OpenAPI Specification",
          content: openApiContent,
          content_type: "application/json",
        });

        progress.report({
          message: "[2/5] Uploading derived Entity Schema...",
        });
        await documentsApi.upsert(projectId(), "ENTITY_SCHEMA", {
          name: "Entity Schema (derived from OpenAPI)",
          content: entitySchema,
          content_type: "application/json",
        });

        progress.report({ message: "[3/5] Uploading Action Spec..." });
        await documentsApi.upsert(projectId(), "ACTION_SPEC", {
          name: "Action Specification",
          content: prompt.trim(),
          content_type: "text/plain",
        });

        progress.report({ message: "[4/5] Uploading Design System..." });
        await documentsApi.upsert(projectId(), "DESIGN_SYSTEM", {
          name: `Design System — ${design.label}`,
          content: design.content,
          content_type: "application/json",
        });

        progress.report({ message: "[5/5] Running generation session..." });
        const session = await sessionsApi.run(projectId(), {
          provider: providerModel.provider,
          model: providerModel.model,
          framework: framework.sessionValue,
          cssStrategy: design.cssStrategy,
        });

        progress.report({
          message: "Generating code — this may take a minute...",
        });
        const result = await pollSession(projectId(), session.id);

        await showSessionResult(result);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(
          `Generation failed: ${extractApiError(e)}`,
        );
      }
    },
  );

  function projectId() {
    return project!.id;
  }
}

//  Polling helper

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
