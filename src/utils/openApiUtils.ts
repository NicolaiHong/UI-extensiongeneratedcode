/**
 * Utilities for parsing OpenAPI/Swagger documents and deriving ENTITY_SCHEMA.
 * Used by the Direct Generate flow (Flow 1).
 */

export interface DerivedSchemas {
  /** The raw OpenAPI document content (as-is) */
  openApiContent: string;
  /** The derived ENTITY_SCHEMA JSON string */
  entitySchema: string;
}

interface EntityField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  format?: string;
  ref?: string;
  enum?: string[];
}

interface Entity {
  name: string;
  fields: EntityField[];
  description?: string;
}

/**
 * Parse an OpenAPI/Swagger JSON string and validate it has the expected root keys.
 * Returns the parsed object or throws on invalid input.
 */
export function parseOpenApiDocument(raw: string): Record<string, any> {
  let doc: Record<string, any>;
  try {
    doc = JSON.parse(raw);
  } catch {
    // Try YAML-style (simple key detection — full YAML parsing not bundled)
    throw new Error(
      "Could not parse the file as JSON. Please provide a valid OpenAPI/Swagger JSON document.",
    );
  }

  if (!doc.openapi && !doc.swagger) {
    throw new Error(
      'Invalid OpenAPI document: missing "openapi" or "swagger" root key.',
    );
  }

  return doc;
}

/**
 * Derive ENTITY_SCHEMA from an OpenAPI document's component schemas.
 * Supports both OpenAPI 3.x (`components.schemas`) and Swagger 2.x (`definitions`).
 */
export function deriveEntitySchema(doc: Record<string, any>): string {
  const schemas: Record<string, any> =
    doc.components?.schemas || doc.definitions || {};

  const entities: Entity[] = [];

  for (const [schemaName, schemaDef] of Object.entries(schemas)) {
    if (!schemaDef || typeof schemaDef !== "object") {
      continue;
    }

    const schema = schemaDef as Record<string, any>;

    // Skip non-object schemas (enums, primitives, arrays at root level)
    if (schema.type && schema.type !== "object" && !schema.properties) {
      continue;
    }

    const requiredFields: string[] = schema.required || [];
    const properties: Record<string, any> = schema.properties || {};
    const fields: EntityField[] = [];

    for (const [propName, propDef] of Object.entries(properties)) {
      if (!propDef || typeof propDef !== "object") {
        continue;
      }

      const prop = propDef as Record<string, any>;
      const field: EntityField = {
        name: propName,
        type: resolveType(prop),
        required: requiredFields.includes(propName),
      };

      if (prop.description) {
        field.description = prop.description;
      }
      if (prop.format) {
        field.format = prop.format;
      }
      if (prop.enum) {
        field.enum = prop.enum;
      }

      // Track $ref for relationship mapping
      const ref = prop.$ref || prop.items?.$ref;
      if (ref) {
        field.ref = extractRefName(ref);
      }

      fields.push(field);
    }

    entities.push({
      name: schemaName,
      fields,
      description: schema.description,
    });
  }

  return JSON.stringify({ entities }, null, 2);
}

/**
 * Convenience: parse + derive in one call.
 */
export function parseAndDerive(rawContent: string): DerivedSchemas {
  const doc = parseOpenApiDocument(rawContent);
  const entitySchema = deriveEntitySchema(doc);
  return {
    openApiContent: rawContent,
    entitySchema,
  };
}

// ── Helpers ──────────────────────────────────────────

function resolveType(prop: Record<string, any>): string {
  if (prop.$ref) {
    return extractRefName(prop.$ref);
  }

  const base = prop.type || "any";

  if (base === "array") {
    if (prop.items?.$ref) {
      return `${extractRefName(prop.items.$ref)}[]`;
    }
    return `${prop.items?.type || "any"}[]`;
  }

  if (prop.format) {
    // Provide more specific types for common formats
    const formatMap: Record<string, string> = {
      "date-time": "DateTime",
      date: "Date",
      uuid: "UUID",
      email: "string (email)",
      uri: "string (uri)",
      int32: "integer",
      int64: "bigint",
      float: "number",
      double: "number",
    };
    return formatMap[prop.format] || base;
  }

  return base;
}

function extractRefName(ref: string): string {
  // "#/components/schemas/User" → "User"
  // "#/definitions/User"       → "User"
  const parts = ref.split("/");
  return parts[parts.length - 1];
}
