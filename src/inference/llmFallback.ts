/**
 * LLM fallback: calls Gemini or OpenAI directly from the extension
 * when direct extraction isn't possible.
 *
 * Reads API keys from VS Code settings.
 */
import * as vscode from "vscode";
import type {
  RankedFile,
  InferredDocument,
  InferrableDocType,
  LogEntry,
  ConfidenceFactor,
} from "./types";

// ── LLM system prompts (deterministic, structured) ──────────────────

const OPENAPI_SYSTEM_PROMPT = `You are a code analyst. Given backend source files, reconstruct an OpenAPI 3.0 JSON specification.

Rules:
- Output ONLY valid JSON.
- Follow OpenAPI 3.0.x structure: openapi, info, paths, components/schemas.
- Include paths, methods, request bodies, response schemas, parameters.
- Be conservative: only include endpoints you can clearly identify.
- Set info.title based on the project context.

Respond with exactly this JSON structure (no markdown fences):
{
  "confidence": <number 0-1 reflecting how complete/certain the spec is>,
  "content": <the OpenAPI spec as a JSON object>
}`;

const ENTITY_SCHEMA_SYSTEM_PROMPT = `You are a code analyst. Given backend source files, extract all data entities/models into a structured schema.

Rules:
- Output ONLY valid JSON.
- Output an object with an "entities" array.
- Each entity: { "name", "fields": [{ "name", "type", "required", "description" }], "relationships": [{ "target", "type", "foreignKey" }] }.
- Be conservative: only include entities clearly defined in the code.
- Map ORM/DB types to simple types (string, number, boolean, date, etc.).

Respond with exactly this JSON structure (no markdown fences):
{
  "confidence": <number 0-1 reflecting completeness>,
  "content": <the entity schema object>
}`;

const SYSTEM_PROMPTS: Record<InferrableDocType, string> = {
  OPENAPI: OPENAPI_SYSTEM_PROMPT,
  ENTITY_SCHEMA: ENTITY_SCHEMA_SYSTEM_PROMPT,
};

// ── Configuration helpers ───────────────────────────────────────────

interface LlmConfig {
  provider: "gemini" | "openai";
  model: string;
  apiKey: string;
  baseUrl?: string;
}

function getLlmConfig(): LlmConfig | null {
  const cfg = vscode.workspace.getConfiguration("uigenai");
  const provider = cfg.get<string>("defaultProvider", "gemini") as
    | "gemini"
    | "openai";
  const model = cfg.get<string>("defaultModel", "gemini-2.0-flash");

  if (provider === "gemini") {
    const apiKey = cfg.get<string>("geminiApiKey", "");
    if (!apiKey) {
      return null;
    }
    return { provider, model, apiKey };
  }

  const apiKey = cfg.get<string>("openaiApiKey", "");
  if (!apiKey) {
    return null;
  }
  const baseUrl = cfg.get<string>("openaiBaseUrl", "https://api.openai.com/v1");
  return { provider, model, apiKey, baseUrl };
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Use an LLM to reconstruct OPENAPI or ENTITY_SCHEMA from source files.
 * Returns null if LLM config is missing or the call fails.
 */
export async function llmReconstruct(
  docType: InferrableDocType,
  files: RankedFile[],
  addLog: (level: LogEntry["level"], msg: string) => void,
): Promise<InferredDocument | null> {
  const config = getLlmConfig();
  if (!config) {
    addLog(
      "warn",
      `[LLM/${docType}] No API key configured. Set uigenai.geminiApiKey or uigenai.openaiApiKey in settings.`,
    );
    return null;
  }

  // Select top files by relevance for this doc type, respecting payload limits
  const relevant = files
    .filter((f) => f.targets.includes(docType))
    .sort((a, b) => b.relevance - a.relevance);

  const selected: RankedFile[] = [];
  let payloadSize = 0;
  const MAX_LLM_PAYLOAD = 256 * 1024; // 256 KB for LLM context

  for (const f of relevant) {
    if (payloadSize + f.size > MAX_LLM_PAYLOAD) {
      break;
    }
    selected.push(f);
    payloadSize += f.size;
  }

  if (selected.length === 0) {
    addLog("warn", `[LLM/${docType}] No relevant files to send`);
    return null;
  }

  addLog(
    "info",
    `[LLM/${docType}] Sending ${selected.length} files (${Math.round(payloadSize / 1024)} KB) to ${config.provider}/${config.model}`,
  );

  const fileSummary = selected
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");

  const userPrompt = `Reconstruct the ${docType} specification from these source files:\n\n${fileSummary}`;

  try {
    const raw =
      config.provider === "gemini"
        ? await callGemini(config, SYSTEM_PROMPTS[docType], userPrompt)
        : await callOpenAI(config, SYSTEM_PROMPTS[docType], userPrompt);

    const parsed = parseResponse(raw);
    const contentStr =
      typeof parsed.content === "string"
        ? parsed.content
        : JSON.stringify(parsed.content, null, 2);

    // Validate the output structure
    const structureValid = validateStructure(docType, parsed.content);
    const modelConfidence = Math.max(
      0,
      Math.min(1, Number(parsed.confidence) || 0),
    );

    // Compute local confidence (don't blindly trust model self-report)
    const factors: ConfidenceFactor[] = [
      {
        name: "extraction-method",
        score: 0.4,
        weight: 0.15,
        detail: "LLM reconstruction (lower than direct)",
      },
      {
        name: "model-confidence",
        score: modelConfidence,
        weight: 0.25,
        detail: `Model self-reported: ${(modelConfidence * 100).toFixed(0)}%`,
      },
      {
        name: "structure-valid",
        score: structureValid ? 0.9 : 0.2,
        weight: 0.3,
        detail: structureValid
          ? "Valid structure"
          : "Invalid/incomplete structure",
      },
      {
        name: "source-quality",
        score: Math.min(
          1,
          selected.filter((f) => f.relevance >= 0.5).length / 3,
        ),
        weight: 0.3,
        detail: `${selected.filter((f) => f.relevance >= 0.5).length} high-relevance source files`,
      },
    ];

    const finalScore = factors.reduce((s, f) => s + f.score * f.weight, 0);

    addLog(
      "info",
      `[LLM/${docType}] Result: model=${(modelConfidence * 100).toFixed(0)}%, local=${(finalScore * 100).toFixed(0)}%, structureValid=${structureValid}`,
    );

    return {
      type: docType,
      content: contentStr,
      extractionMethod: "llm-reconstruct",
      confidence: {
        score: finalScore,
        factors,
        summary: `LLM-reconstructed via ${config.provider}/${config.model} from ${selected.length} files`,
      },
      sourceFiles: selected.map((f) => f.path),
      inferredAt: new Date().toISOString(),
    };
  } catch (err: any) {
    addLog("error", `[LLM/${docType}] Failed: ${err.message}`);
    return null;
  }
}

// ── Structural validation ───────────────────────────────────────────

function validateStructure(docType: InferrableDocType, content: any): boolean {
  if (!content || typeof content !== "object") {
    return false;
  }

  if (docType === "OPENAPI") {
    return (
      (typeof content.openapi === "string" ||
        typeof content.swagger === "string") &&
      typeof content.paths === "object" &&
      Object.keys(content.paths).length > 0
    );
  }

  if (docType === "ENTITY_SCHEMA") {
    return (
      Array.isArray(content.entities) &&
      content.entities.length > 0 &&
      content.entities.every((e: any) => e.name && Array.isArray(e.fields))
    );
  }

  return false;
}

// ── Provider calls ──────────────────────────────────────────────────

async function callGemini(
  config: LlmConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const modelId = config.model.replace(/^models\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${config.apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.15,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Empty Gemini response");
  }
  return text;
}

async function callOpenAI(
  config: LlmConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const url = `${config.baseUrl || "https://api.openai.com/v1"}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.15,
      max_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Empty OpenAI response");
  }
  return text;
}

// ── Response parsing ────────────────────────────────────────────────

function parseResponse(raw: string): { confidence: number; content: any } {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  const parsed = JSON.parse(cleaned);
  if (parsed.confidence === undefined || parsed.content === undefined) {
    throw new Error("Invalid LLM response: missing confidence or content");
  }
  return parsed;
}
