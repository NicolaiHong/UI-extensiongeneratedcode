

import * as vscode from "vscode";
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
import {
  runInference,
  type InferredDocument,
  type InferenceResult,
} from "../inference";

const FLOW_NAME = "Generate from Source";

export async function advancedGenerateCmd(
  _context: vscode.ExtensionContext,
): Promise<void> {
  // ── 1. Pick project ──
  const project = await pickProject(`${FLOW_NAME} — Step 1/7: Select Project`);
  if (!project) {
    return;
  }

  // ── 2. Pick source folder ──
  const folders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Select Folder",
    title: `${FLOW_NAME} — Step 2/7: Select Backend Source Folder`,
  });
  if (!folders?.length) {
    return;
  }

  const rootUri = folders[0];

  // ── 3. Run inference pipeline ──
  let inferenceResult: InferenceResult | undefined;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `${FLOW_NAME} — Scanning source folder...`,
      cancellable: false,
    },
    async () => {
      try {
        inferenceResult = await runInference(rootUri);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Inference failed: ${e.message}`);
      }
    },
  );

  if (!inferenceResult) {
    return;
  }

  // Nothing inferred — offer recovery
  if (inferenceResult.inferred.length === 0) {
    const reasons = inferenceResult.skipped
      .map((s) => `  ${s.type}: ${s.reason}`)
      .join("\n");
    const action = await vscode.window.showWarningMessage(
      `Could not infer any documents.\n${reasons}`,
      "Try Different Folder",
      "Upload Manually",
      "Cancel",
    );
    if (action === "Try Different Folder") {
      await vscode.commands.executeCommand("uigenai.advancedGenerate");
    } else if (action === "Upload Manually") {
      await vscode.commands.executeCommand("uigenai.uploadDocument", project.id);
    }
    return;
  }

  //  4. Review + accept each inferred doc 
  const accepted: Map<string, InferredDocument> = new Map();
  for (const doc of inferenceResult.inferred) {
    const wasAccepted = await offerDocument(doc);
    if (wasAccepted) {
      accepted.set(doc.type, doc);
    }
  }

  if (accepted.size === 0) {
    const action = await vscode.window.showWarningMessage(
      "No documents were accepted. Would you like to upload files manually instead?",
      "Upload Document",
      "Cancel",
    );
    if (action === "Upload Document") {
      await vscode.commands.executeCommand("uigenai.uploadDocument", project.id);
    }
    return;
  }

  // Report skipped types
  if (inferenceResult.skipped.length > 0) {
    const skippedMsg = inferenceResult.skipped
      .map((s) => `${s.type}: ${s.reason}`)
      .join("; ");
    vscode.window.showWarningMessage(`Skipped: ${skippedMsg}`);
  }

  //Collect ACTION_SPEC — user prompt 
  const prompt = await vscode.window.showInputBox({
    title: `${FLOW_NAME} — Step 5/7: Describe What to Generate`,
    prompt: "This becomes the ACTION_SPEC sent to the AI",
    placeHolder:
      "e.g. Create a product management dashboard with CRUD table, search, and filters",
    ignoreFocusOut: true,
  });
  if (!prompt?.trim()) {
    return;
  }

  // Design system preset 
  const design = await pickDesignSystem(`${FLOW_NAME} — Step 6/7: Design System`);
  if (!design) {
    return;
  }

  //  Framework 
  const framework = await pickFramework(`${FLOW_NAME} — Step 6/7: Framework`);
  if (!framework) {
    return;
  }

  //  AI Provider + Model
  const providerModel = await pickProviderAndModel(`${FLOW_NAME} — Step 7/7: AI Provider`);
  if (!providerModel) {
    return;
  }

  //Pre-flight confirmation 
  const acceptedTypes = Array.from(accepted.keys()).join(", ");
  const confirmed = await confirmGeneration([
    `Project: ${project.name}`,
    `Inferred: ${acceptedTypes}`,
    `Prompt: "${prompt.trim().slice(0, 80)}${prompt.trim().length > 80 ? "..." : ""}"`,
    `Stack: ${framework.label} + ${design.label} | ${providerModel.provider}/${providerModel.model}`,
  ]);
  if (!confirmed) {
    return;
  }

  // Upload all documents + run session 
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: FLOW_NAME,
      cancellable: false,
    },
    async (progress) => {
      try {
        // Upload OPENAPI (from inference or skip)
        if (accepted.has("OPENAPI")) {
          progress.report({ message: "[1/5] Uploading inferred OpenAPI..." });
          await documentsApi.upsert(project.id, "OPENAPI", {
            name: "[inferred] OPENAPI",
            content: accepted.get("OPENAPI")!.content,
            content_type: "application/json",
          });
        } else {
          progress.report({
            message: "[1/5] OPENAPI skipped — using existing if any...",
          });
        }

        // Upload ENTITY_SCHEMA (from inference or skip)
        if (accepted.has("ENTITY_SCHEMA")) {
          progress.report({ message: "[2/5] Uploading inferred Entity Schema..." });
          await documentsApi.upsert(project.id, "ENTITY_SCHEMA", {
            name: "[inferred] ENTITY_SCHEMA",
            content: accepted.get("ENTITY_SCHEMA")!.content,
            content_type: "application/json",
          });
        } else {
          progress.report({
            message: "[2/5] ENTITY_SCHEMA skipped — using existing if any...",
          });
        }

        // Upload ACTION_SPEC
        progress.report({ message: "[3/5] Uploading Action Spec..." });
        await documentsApi.upsert(project.id, "ACTION_SPEC", {
          name: "Action Specification",
          content: prompt.trim(),
          content_type: "text/plain",
        });

        // Upload DESIGN_SYSTEM
        progress.report({ message: "[4/5] Uploading Design System..." });
        await documentsApi.upsert(project.id, "DESIGN_SYSTEM", {
          name: `Design System — ${design.label}`,
          content: design.content,
          content_type: "application/json",
        });

        // Run session
        progress.report({ message: "[5/5] Running generation session..." });
        const session = await sessionsApi.run(project.id, {
          provider: providerModel.provider,
          model: providerModel.model,
          framework: framework.sessionValue,
          cssStrategy: design.cssStrategy,
        });

        // Poll for completion
        progress.report({
          message: "Generating code — this may take a minute...",
        });
        const result = await pollSession(project.id, session.id);

        await showSessionResult(result);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(
          `Generation failed: ${extractApiError(e)}`,
        );
      }
    },
  );

  vscode.commands.executeCommand("uigenai.refreshSidebar");
}

//  Offer a single inferred document to the user (inline review) 

async function offerDocument(doc: InferredDocument): Promise<boolean> {
  const pct = `${(doc.confidence.score * 100).toFixed(0)}%`;
  const method = doc.extractionMethod;
  const sources = doc.sourceFiles.length;

  const action = await vscode.window.showInformationMessage(
    `${doc.type} — ${pct} confidence (${method}, ${sources} source file${sources !== 1 ? "s" : ""})`,
    { modal: false },
    "Accept",
    "Preview",
    "Skip",
  );

  if (action === "Preview") {
    const previewDoc = await vscode.workspace.openTextDocument({
      content: doc.content,
      language: "json",
    });
    await vscode.window.showTextDocument(previewDoc, { preview: true });

    const afterPreview = await vscode.window.showInformationMessage(
      `Accept this inferred ${doc.type} for generation?`,
      "Accept",
      "Discard",
    );
    return afterPreview === "Accept";
  }

  return action === "Accept";
}

// Polling helper 

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
