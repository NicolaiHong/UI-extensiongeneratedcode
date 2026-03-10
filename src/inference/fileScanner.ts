/**
 * File scanner: discovers and ranks candidate files from a workspace folder.
 * Handles filtering, size limits, and relevance ranking.
 */
import * as vscode from "vscode";
import type {
  SourceFile,
  RankedFile,
  InferrableDocType,
  LogEntry,
} from "./types";

// ── Scan configuration ──────────────────────────────────────────────

const SCAN_EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".mts",
  ".cts",
  ".java",
  ".kt",
  ".py",
  ".go",
  ".rs",
  ".cs",
  ".prisma",
  ".graphql",
  ".gql",
  ".yaml",
  ".yml",
  ".json",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  "bin",
  "obj",
  "coverage",
  ".turbo",
  ".cache",
  ".parcel-cache",
]);

/** Skip files whose name matches these patterns (generated, minified, lock) */
const SKIP_FILE_PATTERNS = [
  /\.min\./,
  /\.bundle\./,
  /\.generated\./,
  /lock\.json$/,
  /lock\.yaml$/,
  /\.d\.ts$/,
  /\.map$/,
];

const MAX_FILE_SIZE = 64 * 1024; // 64 KB per file
const MAX_TOTAL_SIZE = 512 * 1024; // 512 KB total payload
const MAX_FILE_COUNT = 100;

// ── High-value filename/path patterns per doc type ──────────────────

interface FilePattern {
  /** Regex tested against relative path (lowercase) */
  pattern: RegExp;
  /** Relevance boost 0–1 */
  relevance: number;
  reason: string;
  targets: InferrableDocType[];
}

const FILE_PATTERNS: FilePattern[] = [
  // ── Direct OpenAPI artifacts (highest priority) ──
  {
    pattern: /openapi\.(json|ya?ml)$/,
    relevance: 1.0,
    reason: "OpenAPI spec file",
    targets: ["OPENAPI"],
  },
  {
    pattern: /swagger\.(json|ya?ml)$/,
    relevance: 1.0,
    reason: "Swagger spec file",
    targets: ["OPENAPI"],
  },
  {
    pattern: /api-spec\.(json|ya?ml)$/,
    relevance: 0.9,
    reason: "API spec file",
    targets: ["OPENAPI"],
  },
  {
    pattern: /postman.*collection.*\.json$/,
    relevance: 0.8,
    reason: "Postman collection",
    targets: ["OPENAPI"],
  },

  // ── Direct Entity/Schema artifacts (highest priority) ──
  {
    pattern: /schema\.prisma$/,
    relevance: 1.0,
    reason: "Prisma schema",
    targets: ["ENTITY_SCHEMA"],
  },
  {
    pattern: /\.entity\.(ts|js)$/,
    relevance: 0.9,
    reason: "Entity file",
    targets: ["ENTITY_SCHEMA"],
  },
  {
    pattern: /\.model\.(ts|js)$/,
    relevance: 0.9,
    reason: "Model file",
    targets: ["ENTITY_SCHEMA"],
  },
  {
    pattern: /\.schema\.(ts|js)$/,
    relevance: 0.85,
    reason: "Schema file",
    targets: ["ENTITY_SCHEMA"],
  },

  // ── Route/controller files (useful for both) ──
  {
    pattern: /\.routes?\.(ts|js)$/,
    relevance: 0.7,
    reason: "Route definition",
    targets: ["OPENAPI"],
  },
  {
    pattern: /\.controller\.(ts|js)$/,
    relevance: 0.6,
    reason: "Controller file",
    targets: ["OPENAPI"],
  },

  // ── DTO / validation files ──
  {
    pattern: /dto/i,
    relevance: 0.7,
    reason: "DTO file",
    targets: ["OPENAPI", "ENTITY_SCHEMA"],
  },
  {
    pattern: /types?\/(index|.*)\.(ts|js)$/,
    relevance: 0.6,
    reason: "Type definitions",
    targets: ["ENTITY_SCHEMA"],
  },
  {
    pattern: /interfaces?\.(ts|js)$/,
    relevance: 0.6,
    reason: "Interface file",
    targets: ["ENTITY_SCHEMA"],
  },
  {
    pattern: /validation|validator|zod|yup|joi/i,
    relevance: 0.5,
    reason: "Validation schema",
    targets: ["ENTITY_SCHEMA"],
  },

  // ── DB migration / schema ──
  {
    pattern: /migrations?\//,
    relevance: 0.5,
    reason: "Migration file",
    targets: ["ENTITY_SCHEMA"],
  },
  {
    pattern: /schema\.sql$/,
    relevance: 0.7,
    reason: "SQL schema",
    targets: ["ENTITY_SCHEMA"],
  },

  // ── Config files (low but useful for context) ──
  {
    pattern: /package\.json$/,
    relevance: 0.2,
    reason: "Package manifest",
    targets: ["OPENAPI", "ENTITY_SCHEMA"],
  },
];

const DEFAULT_RELEVANCE = 0.1;

// ── Public API ──────────────────────────────────────────────────────

export interface ScanResult {
  /** All files found, ranked by relevance */
  files: RankedFile[];
  /** Files for OPENAPI inference, best first */
  openApiFiles: RankedFile[];
  /** Files for ENTITY_SCHEMA inference, best first */
  entityFiles: RankedFile[];
  /** Total bytes of all scanned content */
  totalSize: number;
  /** Files that were skipped and why */
  skippedCount: number;
  log: LogEntry[];
}

export async function scanAndRank(rootUri: vscode.Uri): Promise<ScanResult> {
  const log: LogEntry[] = [];
  const addLog = (level: LogEntry["level"], message: string) =>
    log.push({ ts: new Date().toISOString(), level, message });

  addLog("info", `Scanning folder: ${rootUri.fsPath}`);

  const raw: SourceFile[] = [];
  let totalSize = 0;
  let skippedCount = 0;

  await collectFiles(
    rootUri,
    rootUri,
    raw,
    { totalSize: 0, fileCount: 0, skippedCount: 0 },
    addLog,
  );
  totalSize = raw.reduce((s, f) => s + f.size, 0);
  skippedCount = raw.length; // will adjust below

  addLog(
    "info",
    `Found ${raw.length} candidate files (${Math.round(totalSize / 1024)} KB)`,
  );

  // Rank files
  const ranked: RankedFile[] = raw.map((f) => rankFile(f));

  // Sort globally by relevance desc
  ranked.sort((a, b) => b.relevance - a.relevance);

  const openApiFiles = ranked
    .filter((f) => f.targets.includes("OPENAPI"))
    .sort((a, b) => b.relevance - a.relevance);

  const entityFiles = ranked
    .filter((f) => f.targets.includes("ENTITY_SCHEMA"))
    .sort((a, b) => b.relevance - a.relevance);

  addLog(
    "info",
    `Ranked: ${openApiFiles.length} OpenAPI candidates, ${entityFiles.length} Entity candidates`,
  );

  return {
    files: ranked,
    openApiFiles,
    entityFiles,
    totalSize,
    skippedCount,
    log,
  };
}

// ── Internals ───────────────────────────────────────────────────────

interface CollectState {
  totalSize: number;
  fileCount: number;
  skippedCount: number;
}

async function collectFiles(
  uri: vscode.Uri,
  rootUri: vscode.Uri,
  out: SourceFile[],
  state: CollectState,
  addLog: (level: LogEntry["level"], msg: string) => void,
): Promise<void> {
  if (state.totalSize >= MAX_TOTAL_SIZE || state.fileCount >= MAX_FILE_COUNT) {
    return;
  }

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(uri);
  } catch {
    return;
  }

  for (const [name, type] of entries) {
    if (
      state.totalSize >= MAX_TOTAL_SIZE ||
      state.fileCount >= MAX_FILE_COUNT
    ) {
      break;
    }

    const childUri = vscode.Uri.joinPath(uri, name);

    if (type === vscode.FileType.Directory) {
      if (SKIP_DIRS.has(name)) {
        continue;
      }
      await collectFiles(childUri, rootUri, out, state, addLog);
    } else if (type === vscode.FileType.File) {
      const ext = name.includes(".") ? "." + name.split(".").pop()! : "";
      if (!SCAN_EXTENSIONS.has(ext.toLowerCase())) {
        state.skippedCount++;
        continue;
      }
      if (SKIP_FILE_PATTERNS.some((p) => p.test(name))) {
        state.skippedCount++;
        continue;
      }

      try {
        const stat = await vscode.workspace.fs.stat(childUri);
        if (stat.size > MAX_FILE_SIZE) {
          addLog(
            "debug",
            `Skipped (too large): ${name} (${Math.round(stat.size / 1024)} KB)`,
          );
          state.skippedCount++;
          continue;
        }

        const bytes = await vscode.workspace.fs.readFile(childUri);
        const content = Buffer.from(bytes).toString("utf-8");
        const relPath = childUri.path
          .replace(rootUri.path, "")
          .replace(/^\//, "");

        out.push({ path: relPath, content, size: content.length });
        state.totalSize += content.length;
        state.fileCount++;
      } catch {
        state.skippedCount++;
      }
    }
  }
}

function rankFile(file: SourceFile): RankedFile {
  const lower = file.path.toLowerCase();
  let bestRelevance = DEFAULT_RELEVANCE;
  let bestReason = "General source file";
  const targets = new Set<InferrableDocType>();

  for (const p of FILE_PATTERNS) {
    if (p.pattern.test(lower)) {
      if (p.relevance > bestRelevance) {
        bestRelevance = p.relevance;
        bestReason = p.reason;
      }
      for (const t of p.targets) {
        targets.add(t);
      }
    }
  }

  // If no specific pattern matched, this file could still be useful for both
  if (targets.size === 0) {
    targets.add("OPENAPI");
    targets.add("ENTITY_SCHEMA");
  }

  return {
    ...file,
    relevance: bestRelevance,
    reason: bestReason,
    targets: Array.from(targets),
  };
}
