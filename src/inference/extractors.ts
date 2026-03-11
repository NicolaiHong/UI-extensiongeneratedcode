/**
 * Direct extractors: attempt to extract OPENAPI and ENTITY_SCHEMA
 * from explicit artifact files WITHOUT any LLM call.
 *
 * Returns extracted content + extraction metadata, or null if not possible.
 */
import type {
  RankedFile,
  InferredDocument,
  ExtractionMethod,
  LogEntry,
} from "./types";

// ────────────────────────────────────────────────────────────────────
// OpenAPI direct extraction
// ────────────────────────────────────────────────────────────────────

/**
 * Try to extract a valid OpenAPI spec from a direct artifact file
 * (openapi.json, swagger.json, openapi.yaml, etc.)
 */
export function extractOpenApiDirect(
  candidates: RankedFile[],
  addLog: (level: LogEntry["level"], msg: string) => void,
): InferredDocument | null {
  // Only consider files with high relevance that are actual spec files
  const specFiles = candidates.filter(
    (f) =>
      f.relevance >= 0.8 &&
      /\.(json|ya?ml)$/i.test(f.path) &&
      f.targets.includes("OPENAPI"),
  );

  for (const file of specFiles) {
    addLog("info", `[OpenAPI/direct] Trying: ${file.path}`);

    const content = file.content.trim();
    let parsed: any;

    // Try JSON parse
    if (content.startsWith("{")) {
      try {
        parsed = JSON.parse(content);
      } catch {
        addLog("debug", `[OpenAPI/direct] ${file.path} is not valid JSON`);
        continue;
      }
    }

    // Try YAML (basic check — we look for openapi: or swagger: key at top level)
    if (!parsed && /^(openapi|swagger)\s*:/m.test(content)) {
      // For YAML, we pass through raw content if it has the right structure markers
      addLog(
        "info",
        `[OpenAPI/direct] ${file.path} appears to be YAML OpenAPI spec`,
      );
      return {
        type: "OPENAPI",
        content,
        extractionMethod: "direct-file",
        confidence: {
          score: 0.95,
          factors: [
            {
              name: "artifact-type",
              score: 1.0,
              weight: 0.4,
              detail: "YAML file with openapi/swagger key",
            },
            {
              name: "structure",
              score: 0.9,
              weight: 0.3,
              detail: "Contains top-level openapi/swagger declaration",
            },
            {
              name: "completeness",
              score: 0.9,
              weight: 0.3,
              detail: "Appears to be a complete spec file",
            },
          ],
          summary: `Directly extracted from ${file.path} (YAML OpenAPI spec)`,
        },
        sourceFiles: [file.path],
        inferredAt: new Date().toISOString(),
      };
    }

    if (!parsed) {
      continue;
    }

    // Validate OpenAPI structure
    const isOpenApi =
      parsed.openapi &&
      typeof parsed.openapi === "string" &&
      parsed.openapi.startsWith("3");
    const isSwagger =
      parsed.swagger &&
      typeof parsed.swagger === "string" &&
      parsed.swagger.startsWith("2");

    if (!isOpenApi && !isSwagger) {
      // Check if it's a Postman collection
      if (parsed.info && parsed.item && Array.isArray(parsed.item)) {
        addLog(
          "info",
          `[OpenAPI/direct] ${file.path} is a Postman collection — will need LLM conversion`,
        );
        continue; // Let LLM fallback handle Postman→OpenAPI conversion
      }
      addLog(
        "debug",
        `[OpenAPI/direct] ${file.path} is JSON but not OpenAPI/Swagger`,
      );
      continue;
    }

    // Compute confidence based on structural completeness
    const hasPaths = parsed.paths && Object.keys(parsed.paths).length > 0;
    const hasSchemas =
      parsed.components?.schemas &&
      Object.keys(parsed.components.schemas).length > 0;
    const hasInfo = parsed.info?.title;
    const pathCount = hasPaths ? Object.keys(parsed.paths).length : 0;

    const structureScore = hasPaths ? 1.0 : 0.3;
    const completenessScore =
      Math.min(1.0, pathCount / 3) * 0.5 +
      (hasSchemas ? 0.3 : 0) +
      (hasInfo ? 0.2 : 0);

    addLog(
      "info",
      `[OpenAPI/direct] Valid ${isOpenApi ? "OpenAPI 3.x" : "Swagger 2.x"} found: ${pathCount} paths, schemas: ${hasSchemas}`,
    );

    return {
      type: "OPENAPI",
      content: JSON.stringify(parsed, null, 2),
      extractionMethod: "direct-file",
      confidence: {
        score: Math.min(
          0.98,
          0.5 + structureScore * 0.3 + completenessScore * 0.2,
        ),
        factors: [
          {
            name: "artifact-type",
            score: 1.0,
            weight: 0.4,
            detail: `${isOpenApi ? "OpenAPI 3.x" : "Swagger 2.x"} JSON file`,
          },
          {
            name: "structure",
            score: structureScore,
            weight: 0.3,
            detail: hasPaths
              ? `${pathCount} path(s) defined`
              : "No paths found",
          },
          {
            name: "completeness",
            score: completenessScore,
            weight: 0.3,
            detail: `schemas: ${hasSchemas}, info: ${!!hasInfo}`,
          },
        ],
        summary: `Directly extracted from ${file.path}`,
      },
      sourceFiles: [file.path],
      inferredAt: new Date().toISOString(),
    };
  }

  addLog("info", "[OpenAPI/direct] No direct OpenAPI artifact found");
  return null;
}

// ────────────────────────────────────────────────────────────────────
// Entity Schema direct extraction
// ────────────────────────────────────────────────────────────────────

/**
 * Try to extract entity schema directly from Prisma schema or typed source files.
 */
export function extractEntitySchemaDirect(
  candidates: RankedFile[],
  addLog: (level: LogEntry["level"], msg: string) => void,
): InferredDocument | null {
  // Try Prisma schema first (highest fidelity)
  const prismaResult = tryPrismaExtraction(candidates, addLog);
  if (prismaResult) {
    return prismaResult;
  }

  // Try TypeScript/JS entity/model files
  const tsResult = tryTypeScriptEntityExtraction(candidates, addLog);
  if (tsResult) {
    return tsResult;
  }

  // Try SQL schema
  const sqlResult = trySqlSchemaExtraction(candidates, addLog);
  if (sqlResult) {
    return sqlResult;
  }

  addLog("info", "[EntitySchema/direct] No direct entity artifacts found");
  return null;
}

function tryPrismaExtraction(
  candidates: RankedFile[],
  addLog: (level: LogEntry["level"], msg: string) => void,
): InferredDocument | null {
  const prismaFiles = candidates.filter((f) => f.path.endsWith(".prisma"));
  if (prismaFiles.length === 0) {
    return null;
  }

  const file = prismaFiles[0];
  addLog("info", `[EntitySchema/prisma] Parsing: ${file.path}`);

  const models = parsePrismaModels(file.content);
  if (models.length === 0) {
    addLog("warn", `[EntitySchema/prisma] No models found in ${file.path}`);
    return null;
  }

  const schema = {
    entities: models.map((m) => ({
      name: m.name,
      fields: m.fields.map((f) => ({
        name: f.name,
        type: f.type,
        required: !f.optional,
        description:
          f.attributes.length > 0 ? f.attributes.join(" ") : undefined,
      })),
      relationships: m.fields
        .filter((f) => f.isRelation)
        .map((f) => ({
          target: f.type,
          type: f.isList ? "one-to-many" : "one-to-one",
          foreignKey: f.name,
        })),
    })),
  };

  const content = JSON.stringify(schema, null, 2);
  const completeness = Math.min(1.0, models.length / 3);
  const fieldCount = models.reduce((s, m) => s + m.fields.length, 0);
  const fieldScore = Math.min(1.0, fieldCount / 10);

  addLog(
    "info",
    `[EntitySchema/prisma] Extracted ${models.length} models, ${fieldCount} fields`,
  );

  return {
    type: "ENTITY_SCHEMA",
    content,
    extractionMethod: "direct-parse",
    confidence: {
      score: Math.min(0.95, 0.5 + completeness * 0.25 + fieldScore * 0.25),
      factors: [
        {
          name: "artifact-type",
          score: 1.0,
          weight: 0.35,
          detail: "Prisma schema file",
        },
        {
          name: "structure",
          score: 1.0,
          weight: 0.25,
          detail: "Parsed model/field structure",
        },
        {
          name: "completeness",
          score: completeness,
          weight: 0.2,
          detail: `${models.length} model(s)`,
        },
        {
          name: "field-coverage",
          score: fieldScore,
          weight: 0.2,
          detail: `${fieldCount} total field(s)`,
        },
      ],
      summary: `Parsed from ${file.path}: ${models.length} models, ${fieldCount} fields`,
    },
    sourceFiles: [file.path],
    inferredAt: new Date().toISOString(),
  };
}

/** Minimal Prisma schema parser — extracts model names and fields */
interface PrismaModel {
  name: string;
  fields: PrismaField[];
}
interface PrismaField {
  name: string;
  type: string;
  optional: boolean;
  isList: boolean;
  isRelation: boolean;
  attributes: string[];
}

function parsePrismaModels(content: string): PrismaModel[] {
  const models: PrismaModel[] = [];
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = modelRegex.exec(content)) !== null) {
    const name = match[1];
    const body = match[2];
    const fields: PrismaField[] = [];

    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) {
        continue;
      }

      const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(\[\])?\??/);
      if (!fieldMatch) {
        continue;
      }

      const [, fieldName, fieldType, isList] = fieldMatch;
      const optional = trimmed.includes("?");
      const attributes: string[] = [];

      // Extract @attributes
      const attrMatches = trimmed.matchAll(/@(\w+)(?:\([^)]*\))?/g);
      for (const am of attrMatches) {
        attributes.push(am[0]);
      }

      // A field is a relation if its type starts with uppercase and isn't a known scalar
      const scalarTypes = new Set([
        "String",
        "Int",
        "Float",
        "Boolean",
        "DateTime",
        "Json",
        "BigInt",
        "Decimal",
        "Bytes",
      ]);
      const isRelation =
        /^[A-Z]/.test(fieldType) && !scalarTypes.has(fieldType);

      fields.push({
        name: fieldName,
        type: fieldType + (isList ? "[]" : ""),
        optional,
        isList: !!isList,
        isRelation,
        attributes,
      });
    }

    models.push({ name, fields });
  }

  return models;
}

function tryTypeScriptEntityExtraction(
  candidates: RankedFile[],
  addLog: (level: LogEntry["level"], msg: string) => void,
): InferredDocument | null {
  // Collect entity/model/schema TS/JS files
  const entityFiles = candidates.filter(
    (f) =>
      f.relevance >= 0.6 &&
      f.targets.includes("ENTITY_SCHEMA") &&
      /\.(ts|js)$/i.test(f.path),
  );

  if (entityFiles.length === 0) {
    return null;
  }

  addLog(
    "info",
    `[EntitySchema/ts] Found ${entityFiles.length} candidate TS/JS files`,
  );

  const entities: Array<{
    name: string;
    fields: Array<{ name: string; type: string; required: boolean }>;
  }> = [];
  const usedFiles: string[] = [];

  for (const file of entityFiles) {
    const extracted = extractTsInterfaces(file.content);
    if (extracted.length > 0) {
      entities.push(...extracted);
      usedFiles.push(file.path);
    }
  }

  if (entities.length === 0) {
    addLog(
      "info",
      "[EntitySchema/ts] No interfaces/types extracted from TS files",
    );
    return null;
  }

  const schema = {
    entities: entities.map((e) => ({
      name: e.name,
      fields: e.fields.map((f) => ({
        name: f.name,
        type: f.type,
        required: f.required,
      })),
      relationships: [] as Array<{
        target: string;
        type: string;
        foreignKey: string;
      }>,
    })),
  };

  const content = JSON.stringify(schema, null, 2);
  const completeness = Math.min(1.0, entities.length / 3);
  const fieldCount = entities.reduce((s, e) => s + e.fields.length, 0);
  const fieldScore = Math.min(1.0, fieldCount / 8);

  addLog(
    "info",
    `[EntitySchema/ts] Extracted ${entities.length} interfaces, ${fieldCount} fields`,
  );

  return {
    type: "ENTITY_SCHEMA",
    content,
    extractionMethod: "direct-parse",
    confidence: {
      score: Math.min(0.8, 0.35 + completeness * 0.25 + fieldScore * 0.2),
      factors: [
        {
          name: "artifact-type",
          score: 0.7,
          weight: 0.3,
          detail: "TypeScript interface/type files",
        },
        {
          name: "structure",
          score: 0.8,
          weight: 0.25,
          detail: "Parsed interface declarations",
        },
        {
          name: "completeness",
          score: completeness,
          weight: 0.25,
          detail: `${entities.length} interface(s)`,
        },
        {
          name: "field-coverage",
          score: fieldScore,
          weight: 0.2,
          detail: `${fieldCount} total field(s)`,
        },
      ],
      summary: `Parsed from ${usedFiles.length} TS file(s): ${entities.length} interfaces`,
    },
    sourceFiles: usedFiles,
    inferredAt: new Date().toISOString(),
  };
}

/** Extract TypeScript interface/type declarations (best-effort regex) */
function extractTsInterfaces(
  content: string,
): Array<{
  name: string;
  fields: Array<{ name: string; type: string; required: boolean }>;
}> {
  const results: Array<{
    name: string;
    fields: Array<{ name: string; type: string; required: boolean }>;
  }> = [];

  // Match: export interface Foo { ... } or export type Foo = { ... }
  const interfaceRegex =
    /(?:export\s+)?(?:interface|type)\s+(\w+)(?:\s*=\s*)?\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = interfaceRegex.exec(content)) !== null) {
    const name = match[1];
    const body = match[2];
    const fields: Array<{ name: string; type: string; required: boolean }> = [];

    for (const line of body.split("\n")) {
      const trimmed = line.trim().replace(/;$/, "").replace(/,$/, "");
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
        continue;
      }

      // Match: fieldName: Type  or  fieldName?: Type
      const fieldMatch = trimmed.match(/^(\w+)(\?)?:\s*(.+)/);
      if (fieldMatch) {
        fields.push({
          name: fieldMatch[1],
          type: fieldMatch[3].trim(),
          required: !fieldMatch[2],
        });
      }
    }

    if (fields.length > 0) {
      results.push({ name, fields });
    }
  }

  return results;
}

function trySqlSchemaExtraction(
  candidates: RankedFile[],
  addLog: (level: LogEntry["level"], msg: string) => void,
): InferredDocument | null {
  const sqlFiles = candidates.filter(
    (f) => /\.sql$/i.test(f.path) && f.relevance >= 0.5,
  );

  if (sqlFiles.length === 0) {
    return null;
  }

  const file = sqlFiles[0];
  addLog("info", `[EntitySchema/sql] Parsing: ${file.path}`);

  const tables = parseSqlTables(file.content);
  if (tables.length === 0) {
    addLog("warn", `[EntitySchema/sql] No CREATE TABLE found in ${file.path}`);
    return null;
  }

  const schema = {
    entities: tables.map((t) => ({
      name: t.name,
      fields: t.columns.map((c) => ({
        name: c.name,
        type: c.type,
        required: c.notNull,
        description:
          c.constraints.length > 0 ? c.constraints.join(", ") : undefined,
      })),
      relationships: [] as Array<{
        target: string;
        type: string;
        foreignKey: string;
      }>,
    })),
  };

  const content = JSON.stringify(schema, null, 2);
  const completeness = Math.min(1.0, tables.length / 3);

  addLog("info", `[EntitySchema/sql] Extracted ${tables.length} tables`);

  return {
    type: "ENTITY_SCHEMA",
    content,
    extractionMethod: "direct-parse",
    confidence: {
      score: Math.min(0.85, 0.45 + completeness * 0.3),
      factors: [
        {
          name: "artifact-type",
          score: 0.85,
          weight: 0.35,
          detail: "SQL schema file",
        },
        {
          name: "structure",
          score: 0.9,
          weight: 0.3,
          detail: "Parsed CREATE TABLE statements",
        },
        {
          name: "completeness",
          score: completeness,
          weight: 0.35,
          detail: `${tables.length} table(s)`,
        },
      ],
      summary: `Parsed from ${file.path}: ${tables.length} tables`,
    },
    sourceFiles: [file.path],
    inferredAt: new Date().toISOString(),
  };
}

interface SqlTable {
  name: string;
  columns: Array<{
    name: string;
    type: string;
    notNull: boolean;
    constraints: string[];
  }>;
}

function parseSqlTables(content: string): SqlTable[] {
  const tables: SqlTable[] = [];
  const tableRegex =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?\s*\(([^;]+)\)/gi;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(content)) !== null) {
    const name = match[1];
    const body = match[2];
    const columns: SqlTable["columns"] = [];

    for (const line of body.split(",")) {
      const trimmed = line.trim();
      if (/^(PRIMARY|UNIQUE|CHECK|CONSTRAINT|FOREIGN|INDEX)/i.test(trimmed)) {
        continue;
      }

      const colMatch = trimmed.match(
        /^["']?(\w+)["']?\s+(\w+(?:\([^)]*\))?)\s*(.*)/i,
      );
      if (colMatch) {
        const constraints: string[] = [];
        const rest = colMatch[3].toUpperCase();
        if (rest.includes("PRIMARY KEY")) {
          constraints.push("PRIMARY KEY");
        }
        if (rest.includes("UNIQUE")) {
          constraints.push("UNIQUE");
        }
        if (rest.includes("REFERENCES")) {
          constraints.push("FOREIGN KEY");
        }

        columns.push({
          name: colMatch[1],
          type: colMatch[2],
          notNull: rest.includes("NOT NULL") || rest.includes("PRIMARY KEY"),
          constraints,
        });
      }
    }

    if (columns.length > 0) {
      tables.push({ name, columns });
    }
  }

  return tables;
}
