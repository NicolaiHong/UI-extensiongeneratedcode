/**
 * Inference orchestrator: ties scan → extractors → LLM fallback
 * into a single pipeline that produces InferenceResult.
 *
 * Call `runInference(rootUri, targets?)` from commands or the session flow.
 */
import * as vscode from "vscode";
import type {
  InferrableDocType,
  InferenceResult,
  InferredDocument,
  LogEntry,
} from "./types";
import { CONFIDENCE_THRESHOLDS } from "./types";
import { scanAndRank } from "./fileScanner";
import { extractOpenApiDirect, extractEntitySchemaDirect } from "./extractors";
import { llmReconstruct } from "./llmFallback";

const ALL_INFERRABLE: InferrableDocType[] = ["OPENAPI", "ENTITY_SCHEMA"];

export interface InferenceOptions {
  /** Which doc types to attempt (default: both) */
  targets?: InferrableDocType[];
  /** Skip LLM fallback even when direct extraction fails */
  skipLlm?: boolean;
}

/**
 * Run the full inference pipeline:
 *   1. Scan workspace folder for candidate files
 *   2. For each target doc type:
 *      a. Try direct extraction (direct-file / direct-parse)
 *      b. If that fails or is low-confidence, try LLM reconstruction
 *      c. Apply confidence threshold — skip if below
 *   3. Return all inferred docs + skipped types + log
 */
export async function runInference(
  rootUri: vscode.Uri,
  options: InferenceOptions = {},
): Promise<InferenceResult> {
  const targets = options.targets ?? ALL_INFERRABLE;
  const log: LogEntry[] = [];
  const addLog = (level: LogEntry["level"], msg: string) => {
    log.push({ ts: new Date().toISOString(), level, message: msg });
  };

  addLog(
    "info",
    `Starting inference for [${targets.join(", ")}] at ${rootUri.fsPath}`,
  );

  // Step 1: scan and rank files
  const scan = await scanAndRank(rootUri);
  addLog(
    "info",
    `Scanned: ${scan.openApiFiles.length} OpenAPI candidates, ${scan.entityFiles.length} entity candidates`,
  );

  const inferred: InferredDocument[] = [];
  const skipped: InferenceResult["skipped"] = [];

  for (const docType of targets) {
    const candidates =
      docType === "OPENAPI" ? scan.openApiFiles : scan.entityFiles;
    const threshold = CONFIDENCE_THRESHOLDS[docType];

    // Step 2a: try direct extraction
    let result: InferredDocument | null = null;

    if (docType === "OPENAPI") {
      result = extractOpenApiDirect(candidates, addLog);
    } else {
      result = extractEntitySchemaDirect(candidates, addLog);
    }

    // Step 2b: LLM fallback if direct missed or low-confidence
    if (!result && !options.skipLlm) {
      addLog(
        "info",
        `[${docType}] Direct extraction failed, trying LLM fallback…`,
      );
      result = await llmReconstruct(docType, candidates, addLog);
    } else if (
      result &&
      result.confidence.score < threshold &&
      !options.skipLlm
    ) {
      addLog(
        "info",
        `[${docType}] Direct confidence ${(result.confidence.score * 100).toFixed(0)}% < threshold ${(threshold * 100).toFixed(0)}%, trying LLM…`,
      );
      const llmResult = await llmReconstruct(docType, candidates, addLog);
      if (llmResult && llmResult.confidence.score > result.confidence.score) {
        addLog(
          "info",
          `[${docType}] LLM result (${(llmResult.confidence.score * 100).toFixed(0)}%) beats direct (${(result.confidence.score * 100).toFixed(0)}%)`,
        );
        result = llmResult;
      }
    }

    // Step 2c: apply threshold
    if (result && result.confidence.score >= threshold) {
      inferred.push(result);
      addLog(
        "info",
        `[${docType}] ✓ Accepted (${(result.confidence.score * 100).toFixed(0)}% via ${result.extractionMethod})`,
      );
    } else if (result) {
      skipped.push({
        type: docType,
        reason: `Confidence ${(result.confidence.score * 100).toFixed(0)}% below threshold ${(threshold * 100).toFixed(0)}%`,
      });
      addLog("warn", `[${docType}] ✗ Rejected: confidence too low`);
    } else {
      skipped.push({
        type: docType,
        reason: "No extraction possible (direct + LLM both failed)",
      });
      addLog("warn", `[${docType}] ✗ Skipped: no extraction possible`);
    }
  }

  addLog(
    "info",
    `Inference complete: ${inferred.length} inferred, ${skipped.length} skipped`,
  );
  return { inferred, skipped, log };
}
