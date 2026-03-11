/**
 * Shared types for the local inference pipeline.
 * All inference runs entirely inside the VS Code extension.
 */

export type InferrableDocType = "OPENAPI" | "ENTITY_SCHEMA";

/** How the content was obtained */
export type ExtractionMethod =
  | "direct-file" // Found an explicit artifact (openapi.json, schema.prisma, etc.)
  | "direct-parse" // Parsed structure from typed source files (TS interfaces, ORM models)
  | "llm-reconstruct"; // Fell back to LLM to reconstruct from source code

/** A single source file read from the workspace */
export interface SourceFile {
  /** Relative path from scan root */
  path: string;
  content: string;
  /** Size in bytes */
  size: number;
}

/** Ranked candidate file with relevance metadata */
export interface RankedFile extends SourceFile {
  /** 0–1 relevance score for a given doc type */
  relevance: number;
  /** Why this file was ranked highly */
  reason: string;
  /** Which doc type(s) this file is relevant to */
  targets: InferrableDocType[];
}

/** Machine-readable confidence breakdown */
export interface ConfidenceReport {
  /** Final score 0–1 */
  score: number;
  /** Individual evidence factors */
  factors: ConfidenceFactor[];
  /** Human-readable one-liner */
  summary: string;
}

export interface ConfidenceFactor {
  name: string;
  /** 0–1 */
  score: number;
  weight: number;
  detail: string;
}

/** Result of inferring a single document type */
export interface InferredDocument {
  type: InferrableDocType;
  content: string;
  extractionMethod: ExtractionMethod;
  confidence: ConfidenceReport;
  /** Paths of source files used */
  sourceFiles: string[];
  /** ISO timestamp */
  inferredAt: string;
}

/** Aggregate result of the full inference pipeline */
export interface InferenceResult {
  inferred: InferredDocument[];
  skipped: InferenceSkip[];
  /** Debug log entries */
  log: LogEntry[];
}

export interface InferenceSkip {
  type: InferrableDocType;
  reason: string;
}

export interface LogEntry {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
}

/** Thresholds — can differ per doc type */
export const CONFIDENCE_THRESHOLDS: Record<InferrableDocType, number> = {
  OPENAPI: 0.55,
  ENTITY_SCHEMA: 0.5,
};
