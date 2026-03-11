import * as vscode from "vscode";
import { documentsApi, DocumentType } from "../api/documents.api";
import { extractApiError } from "../utils/errors";
import {
  runInference,
  type InferredDocument,
  type InferenceResult,
} from "../inference";

/**
 * Command: infer OPENAPI and/or ENTITY_SCHEMA from a local folder.
 *
 * Runs entirely in the extension (no backend inference API).
 * Uses tiered extraction: direct-file → direct-parse → LLM fallback.
 */
export async function inferFromFolderCmd(projectId?: string) {
  if (!projectId) {
    vscode.window.showErrorMessage("Please select a project first.");
    return;
  }

  // 1. Pick folder
  const folders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Scan Folder",
    title: "Infer API & Entities — Select Backend Source Folder",
  });
  if (!folders || folders.length === 0) {
    return;
  }

  const rootUri = folders[0];

  // 2. Run local inference pipeline with progress
  let result: InferenceResult | undefined;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Infer API & Entities — Scanning source folder...",
      cancellable: false,
    },
    async () => {
      try {
        result = await runInference(rootUri);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Inference failed: ${e.message}`);
      }
    },
  );

  if (!result) {
    return;
  }

  // 3. Nothing inferred — show reasons
  if (result.inferred.length === 0) {
    const reasons = result.skipped
      .map((s) => `${s.type}: ${s.reason}`)
      .join("\n");
    vscode.window.showWarningMessage(
      `Could not infer any documents.\n${reasons}`,
    );
    return;
  }

  // 4. For each inferred doc: show confidence + preview/accept/skip + safe upload
  for (const doc of result.inferred) {
    await offerDocument(projectId, doc);
  }

  // 5. Report skipped types
  if (result.skipped.length > 0) {
    const skippedMsg = result.skipped
      .map((s) => `${s.type}: ${s.reason}`)
      .join("; ");
    vscode.window.showWarningMessage(`Skipped: ${skippedMsg}`);
  }

  vscode.commands.executeCommand("uigenai.refreshSidebar");
}

// ── Offer a single inferred document to the user ────────────────────

async function offerDocument(projectId: string, doc: InferredDocument) {
  const pct = `${(doc.confidence.score * 100).toFixed(0)}%`;
  const method = doc.extractionMethod;
  const sources = doc.sourceFiles.length;

  const action = await vscode.window.showInformationMessage(
    `${doc.type} — ${pct} confidence (${method}, ${sources} source file${sources !== 1 ? "s" : ""}). Accept and upload?`,
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
      `Upload this inferred ${doc.type}?`,
      "Upload",
      "Discard",
    );
    if (afterPreview !== "Upload") {
      return;
    }
  } else if (action !== "Accept") {
    return;
  }

  // Safe persistence: check if document already exists
  await safeUpsert(projectId, doc);
}

// ── Safe persistence — no silent overwrites ─────────────────────────

async function safeUpsert(projectId: string, doc: InferredDocument) {
  const docType = doc.type as DocumentType;

  try {
    // Check if a document of this type already exists
    const existing = await documentsApi
      .getByType(projectId, docType)
      .catch(() => null);

    if (existing) {
      const overwrite = await vscode.window.showWarningMessage(
        `A ${docType} document already exists (updated ${new Date(existing.updated_at).toLocaleString()}). Overwrite with inferred version?`,
        { modal: true },
        "Overwrite",
        "Cancel",
      );
      if (overwrite !== "Overwrite") {
        return;
      }
    }

    await documentsApi.upsert(projectId, docType, {
      name: `[inferred] ${docType}`,
      content: doc.content,
    });
    vscode.window.showInformationMessage(`${docType} uploaded successfully.`);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(
      `Failed to upload ${docType}: ${extractApiError(e)}`,
    );
  }
}
