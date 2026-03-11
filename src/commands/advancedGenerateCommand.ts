/**
 * Flow 2 — Advanced Generate (Infer + Session)
 *
 * User picks a backend project folder → extension runs the local
 * inference pipeline (scan → extract → LLM fallback) → user reviews
 * and accepts inferred OPENAPI + ENTITY_SCHEMA → collects ACTION_SPEC
 * (prompt) and DESIGN_SYSTEM (preset) → uploads all 4 documents →
 * runs a session via the existing backend.
 *
 * Uses the SAME backend execution model as Flow 1.
 */

import * as vscode from "vscode";
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
import {
  runInference,
  type InferredDocument,
  type InferenceResult,
} from "../inference";

export async function advancedGenerateCmd(
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
    {
      title: "Advanced Generate — Select Project",
      placeHolder: "Choose the target project",
    },
  );
  if (!projectPick) {
    return;
  }
  const projectId = projectPick.value;

  // ── 2. Pick source folder ──
  const folders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Scan Folder",
    title: "Select backend project folder to infer API & entities from",
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
      title: "🔍 Scanning & inferring API + entities…",
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

  // Nothing inferred — show reasons and bail
  if (inferenceResult.inferred.length === 0) {
    const reasons = inferenceResult.skipped
      .map((s) => `${s.type}: ${s.reason}`)
      .join("\n");
    vscode.window.showWarningMessage(
      `Could not infer any documents. ${reasons}`,
    );
    return;
  }

  // ── 4. Review + accept each inferred doc ──
  const accepted: Map<string, InferredDocument> = new Map();
  for (const doc of inferenceResult.inferred) {
    const wasAccepted = await offerDocument(doc);
    if (wasAccepted) {
      accepted.set(doc.type, doc);
    }
  }

  if (accepted.size === 0) {
    vscode.window.showWarningMessage("No inferred documents were accepted. Aborting.");
    return;
  }

  // Report skipped types
  if (inferenceResult.skipped.length > 0) {
    const skippedMsg = inferenceResult.skipped
      .map((s) => `${s.type}: ${s.reason}`)
      .join("; ");
    vscode.window.showWarningMessage(`Skipped: ${skippedMsg}`);
  }

  // ── 5. Collect ACTION_SPEC — user prompt ──
  const prompt = await vscode.window.showInputBox({
    title: "Advanced Generate — What to build?",
    prompt:
      "Describe the UI / pages you want to generate (this becomes the ACTION_SPEC)",
    placeHolder:
      "e.g. Create a product management dashboard with CRUD table, search, and filters",
    ignoreFocusOut: true,
  });
  if (!prompt?.trim()) {
    return;
  }

  // ── 6. Design system preset ──
  const designPick = await vscode.window.showQuickPick(
    DESIGN_SYSTEMS.map((d) => ({
      label: d.label,
      description: d.value,
      value: d,
    })),
    {
      title: "Design System / CSS",
      placeHolder: "Select the design system preset",
    },
  );
  if (!designPick) {
    return;
  }
  const designContent = buildDesignSystemContent(designPick.value);
  const cssStrategy = designPick.value.cssStrategy;

  // ── 7. Framework ──
  const frameworkPick = await vscode.window.showQuickPick(
    FRAMEWORKS.map((f) => ({
      label: f.label,
      description: f.value,
      value: f,
    })),
    { title: "Framework", placeHolder: "Select the frontend framework" },
  );
  if (!frameworkPick) {
    return;
  }

  // ── 8. AI Provider + Model ──
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

  // ── 9. Upload all 4 documents + run session ──
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "🚀 Advanced Generate",
      cancellable: false,
    },
    async (progress) => {
      try {
        // Upload OPENAPI (from inference or skip)
        if (accepted.has("OPENAPI")) {
          progress.report({ message: "Uploading inferred OpenAPI…" });
          await documentsApi.upsert(projectId, "OPENAPI", {
            name: "[inferred] OPENAPI",
            content: accepted.get("OPENAPI")!.content,
            content_type: "application/json",
          });
        } else {
          progress.report({
            message: "OPENAPI skipped — using existing document if any…",
          });
        }

        // Upload ENTITY_SCHEMA (from inference or skip)
        if (accepted.has("ENTITY_SCHEMA")) {
          progress.report({ message: "Uploading inferred Entity Schema…" });
          await documentsApi.upsert(projectId, "ENTITY_SCHEMA", {
            name: "[inferred] ENTITY_SCHEMA",
            content: accepted.get("ENTITY_SCHEMA")!.content,
            content_type: "application/json",
          });
        } else {
          progress.report({
            message:
              "ENTITY_SCHEMA skipped — using existing document if any…",
          });
        }

        // Upload ACTION_SPEC
        progress.report({ message: "Uploading Action Spec…" });
        await documentsApi.upsert(projectId, "ACTION_SPEC", {
          name: "Action Specification",
          content: prompt.trim(),
          content_type: "text/plain",
        });

        // Upload DESIGN_SYSTEM
        progress.report({ message: "Uploading Design System…" });
        await documentsApi.upsert(projectId, "DESIGN_SYSTEM", {
          name: `Design System — ${designPick.value.label}`,
          content: designContent,
          content_type: "application/json",
        });

        // Run session
        progress.report({ message: "Starting generation session…" });
        const session = await sessionsApi.run(projectId, {
          provider: providerPick.value,
          model,
          framework: frameworkPick.value.sessionValue,
          cssStrategy,
        });

        // Poll for completion
        progress.report({
          message: "Generating code — this may take a minute…",
        });
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
          `Advanced Generate failed: ${extractApiError(e)}`,
        );
      }
    },
  );

  vscode.commands.executeCommand("uigenai.refreshSidebar");
}

// ── Offer a single inferred document to the user (inline review) ─────

async function offerDocument(doc: InferredDocument): Promise<boolean> {
  const pct = `${(doc.confidence.score * 100).toFixed(0)}%`;
  const method = doc.extractionMethod;
  const sources = doc.sourceFiles.length;

  const action = await vscode.window.showInformationMessage(
    `Inferred ${doc.type} (${pct} confidence, ${method}, ${sources} source files). Accept?`,
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

// ── Polling helper (same as directGenerateCommand) ───────────────────

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
