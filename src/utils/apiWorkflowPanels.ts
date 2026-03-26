import * as vscode from "vscode";
import { Session } from "../api/sessions.api";
import { escapeHtml } from "./html";

interface PreviewReviewOptions {
  apiName: string;
  session: Session;
  onGenerateFull?: () => Promise<void> | void;
  onRegenerate?: () => Promise<void> | void;
}

/**
 * PreviewSessionContent - normalized output from extractPreviewSessionContent
 */
export interface PreviewSessionContent {
  previewHtml: string;
  rawOutput: string;
  summary: string;
  sourceMetadata: {
    source: "files" | "changes" | "markdown" | "direct" | "fallback";
    fileCount: number;
    htmlFileName: string | null;
  };
}

/**
 * Extract HTML from markdown code blocks.
 * Handles: ```html\n...\n```, ```\n<!DOCTYPE...\n```, or direct HTML
 */
function unwrapCodeFences(text: string): string | null {
  if (!text) return null;

  // Pattern 1: ```html\n...\n```
  const htmlBlockMatch = text.match(/```html\s*\n([\s\S]*?)\n```/i);
  if (htmlBlockMatch) {
    return htmlBlockMatch[1].trim();
  }

  // Pattern 2: ```\n<!DOCTYPE...\n``` (any language or no language)
  const doctypeBlockMatch = text.match(/```\w*\s*\n(<!DOCTYPE[\s\S]*?)\n```/i);
  if (doctypeBlockMatch) {
    return doctypeBlockMatch[1].trim();
  }

  // Pattern 3: ```\n<html...\n```
  const htmlTagMatch = text.match(/```\w*\s*\n(<html[\s\S]*?)\n```/i);
  if (htmlTagMatch) {
    return htmlTagMatch[1].trim();
  }

  // Pattern 4: Direct HTML (no code block)
  const trimmed = text.trim();
  if (
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<HTML")
  ) {
    return trimmed;
  }

  return null;
}

/**
 * Get file path from various field names used by AI responses.
 */
function getFilePath(file: any): string | null {
  return file?.fileName || file?.path || file?.name || file?.filePath || null;
}

/**
 * Get file content from various field names.
 */
function getFileContent(file: any): string | null {
  return file?.codeContent || file?.content || file?.code || null;
}

/**
 * Check if path is an HTML file.
 */
function isHtmlFile(path: string | null): boolean {
  if (!path) return false;
  const lower = path.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm");
}

/**
 * extractPreviewSessionContent - Main normalization helper
 *
 * Takes a Session object and extracts normalized preview content.
 * Handles all backend response formats with fallback resolution.
 *
 * Fallback priority:
 * 1. JSON envelope with files array: { summary_md, files: [{ path, content }] }
 * 2. JSON envelope with changes array: { changes: [{ fileName, codeContent }] }
 * 3. Markdown with HTML code fences
 * 4. Direct HTML content
 * 5. Fallback message
 */
export function extractPreviewSessionContent(
  session: Session,
): PreviewSessionContent {
  const output = session.output_summary_md || "";

  const result: PreviewSessionContent = {
    previewHtml: "",
    rawOutput: output,
    summary: "",
    sourceMetadata: {
      source: "fallback",
      fileCount: 0,
      htmlFileName: null,
    },
  };

  if (!output?.trim()) {
    console.log("[extractPreviewSessionContent] Empty output");
    result.previewHtml =
      '<div style="padding:20px;color:#666;text-align:center;">No preview HTML returned from generation.</div>';
    return result;
  }

  const trimmed = output.trim();
  console.log(
    "[extractPreviewSessionContent] Input length:",
    trimmed.length,
    "starts with:",
    trimmed.substring(0, 50),
  );

  // Try to parse as JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      console.log(
        "[extractPreviewSessionContent] Parsed JSON keys:",
        Object.keys(parsed),
      );

      result.summary = parsed.summary_md || parsed.summary || "";

      // Case 1: { files: [...] } - Backend envelope format
      if (Array.isArray(parsed.files) && parsed.files.length > 0) {
        console.log(
          "[extractPreviewSessionContent] Found files array with",
          parsed.files.length,
          "files",
        );
        result.sourceMetadata.source = "files";
        result.sourceMetadata.fileCount = parsed.files.length;

        // Find HTML file first
        const htmlFile = parsed.files.find((f: any) =>
          isHtmlFile(getFilePath(f)),
        );
        if (htmlFile) {
          const content = getFileContent(htmlFile);
          const filePath = getFilePath(htmlFile);
          console.log(
            "[extractPreviewSessionContent] Found HTML file:",
            filePath,
            "content length:",
            content?.length,
          );
          if (content) {
            result.previewHtml = unwrapCodeFences(content) || content;
            result.sourceMetadata.htmlFileName = filePath;
            return result;
          }
        }

        // Fallback to first file with content
        for (const file of parsed.files) {
          const content = getFileContent(file);
          if (content) {
            const filePath = getFilePath(file);
            console.log(
              "[extractPreviewSessionContent] Using first file:",
              filePath,
              "length:",
              content.length,
            );
            result.previewHtml = unwrapCodeFences(content) || content;
            result.sourceMetadata.htmlFileName = filePath;
            return result;
          }
        }
      }

      // Case 2: { changes: [...] } - Alternative response format
      if (Array.isArray(parsed.changes) && parsed.changes.length > 0) {
        console.log(
          "[extractPreviewSessionContent] Found changes array with",
          parsed.changes.length,
          "changes",
        );
        result.sourceMetadata.source = "changes";
        result.sourceMetadata.fileCount = parsed.changes.length;

        const htmlFile = parsed.changes.find((f: any) =>
          isHtmlFile(getFilePath(f)),
        );
        if (htmlFile) {
          const content = getFileContent(htmlFile);
          const filePath = getFilePath(htmlFile);
          console.log(
            "[extractPreviewSessionContent] Found HTML in changes:",
            filePath,
            "length:",
            content?.length,
          );
          if (content) {
            result.previewHtml = unwrapCodeFences(content) || content;
            result.sourceMetadata.htmlFileName = filePath;
            return result;
          }
        }

        for (const file of parsed.changes) {
          const content = getFileContent(file);
          if (content) {
            const filePath = getFilePath(file);
            result.previewHtml = unwrapCodeFences(content) || content;
            result.sourceMetadata.htmlFileName = filePath;
            return result;
          }
        }
      }

      // Case 3: { codeContent: "..." } directly
      if (parsed.codeContent) {
        result.sourceMetadata.source = "direct";
        result.previewHtml =
          unwrapCodeFences(parsed.codeContent) || parsed.codeContent;
        return result;
      }

      // Case 4: { html: "..." }
      if (parsed.html) {
        result.sourceMetadata.source = "direct";
        result.previewHtml = unwrapCodeFences(parsed.html) || parsed.html;
        return result;
      }

      // Case 5: summary_md contains HTML in markdown code block
      if (result.summary) {
        const extractedHtml = unwrapCodeFences(result.summary);
        if (extractedHtml) {
          result.sourceMetadata.source = "markdown";
          result.previewHtml = extractedHtml;
          // Clean the summary for display
          result.summary = result.summary
            .replace(/```html\s*\n[\s\S]*?\n```/gi, "")
            .replace(/```\w*\s*\n<!DOCTYPE[\s\S]*?\n```/gi, "")
            .replace(/```\w*\s*\n<html[\s\S]*?\n```/gi, "")
            .trim();
          return result;
        }
      }
    } catch (e) {
      console.log("[extractPreviewSessionContent] JSON parse error:", e);
      // Not valid JSON, continue to other methods
    }
  }

  // Try to extract HTML from markdown code block
  const extractedHtml = unwrapCodeFences(trimmed);
  if (extractedHtml) {
    result.sourceMetadata.source = "markdown";
    result.previewHtml = extractedHtml;
    result.summary = trimmed
      .replace(/```html\s*\n[\s\S]*?\n```/gi, "")
      .replace(/```\w*\s*\n<!DOCTYPE[\s\S]*?\n```/gi, "")
      .replace(/```\w*\s*\n<html[\s\S]*?\n```/gi, "")
      .trim();
    return result;
  }

  // Check if it looks like direct HTML
  if (
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<HTML")
  ) {
    result.sourceMetadata.source = "direct";
    result.previewHtml = trimmed;
    return result;
  }

  // Fallback: show the raw content as the preview
  console.log(
    "[extractPreviewSessionContent] No HTML found, using fallback display",
  );
  result.sourceMetadata.source = "fallback";
  result.previewHtml = `<div style="padding:20px;font-family:monospace;white-space:pre-wrap;background:#f5f5f5;color:#333;">${escapeHtml(trimmed.substring(0, 2000))}${trimmed.length > 2000 ? "..." : ""}</div>`;
  return result;
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use extractPreviewSessionContent instead
 */
export function extractHtmlFromOutput(output: string): {
  html: string;
  summary: string;
} {
  const mockSession: Session = {
    id: "",
    project_id: "",
    api_id: null,
    provider: "",
    model: "",
    mode: "PREVIEW",
    status: "SUCCEEDED",
    error_message: null,
    output_summary_md: output,
    created_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
  };
  const result = extractPreviewSessionContent(mockSession);
  return { html: result.previewHtml, summary: result.summary };
}

/**
 * Safely escape content for embedding in inline script.
 * Converts </script and <!-- sequences to escaped forms that evaluate correctly.
 */
function safeJsonForScript(value: string): string {
  return JSON.stringify(value)
    .replace(/<\//g, "<\\/")
    .replace(/<!--/g, "<\\!--");
}

export function showPreviewReviewPanel(opts: PreviewReviewOptions): void {
  const panel = vscode.window.createWebviewPanel(
    "uigenai-preview-review",
    `Preview — ${opts.apiName}`,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  // Use the new normalized extraction function
  const extracted = extractPreviewSessionContent(opts.session);

  console.log("[PreviewPanel] rawOutput length:", extracted.rawOutput.length);
  console.log(
    "[PreviewPanel] rawOutput preview:",
    extracted.rawOutput.substring(0, 500),
  );
  console.log(
    "[PreviewPanel] extracted html length:",
    extracted.previewHtml.length,
  );
  console.log(
    "[PreviewPanel] extracted html preview:",
    extracted.previewHtml.substring(0, 300),
  );
  console.log("[PreviewPanel] source metadata:", extracted.sourceMetadata);

  const createdAt = new Date(opts.session.created_at).toLocaleString();
  const status = opts.session.status;

  panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.type) {
      case "copy":
        await vscode.env.clipboard.writeText(extracted.previewHtml);
        vscode.window.showInformationMessage(
          "Preview HTML copied to clipboard.",
        );
        break;
      case "generateFull":
        if (opts.onGenerateFull) {
          await opts.onGenerateFull();
        } else {
          vscode.window.showWarningMessage(
            "Full source generation is not available.",
          );
        }
        break;
      case "regenerate":
        if (opts.onRegenerate) {
          await opts.onRegenerate();
        } else {
          vscode.window.showWarningMessage(
            "Regenerate action is not available.",
          );
        }
        break;
    }
  });

  // Safely escape content for inline script embedding
  const sanitizedJson = safeJsonForScript(extracted.previewHtml);
  const rawJson = safeJsonForScript(extracted.previewHtml);

  panel.webview.html = /*html*/ `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;background:#1e1e1e;color:#ccc;height:100vh;display:flex;flex-direction:column;overflow:hidden}
.header{background:#252526;border-bottom:1px solid #3c3c3c;padding:12px 16px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between}
.title{font-size:14px;font-weight:700;color:#fff}
.meta{font-size:11px;color:#888;display:flex;gap:12px;align-items:center}
.badge{font-size:10px;padding:2px 8px;border-radius:12px;font-weight:700;text-transform:uppercase}
.st-ok{background:rgba(78,201,176,.15);color:#4ec9b0}
.st-err{background:rgba(244,71,71,.15);color:#f44747}
.st-run{background:rgba(0,122,204,.15);color:#4fc1ff}
.st-queue{background:rgba(220,220,170,.15);color:#dcdcaa}
.actions{display:flex;gap:6px;padding:10px 16px;border-bottom:1px solid #3c3c3c;background:#252526;flex-shrink:0;flex-wrap:wrap}
.btn{padding:6px 12px;border-radius:4px;border:1px solid transparent;font-size:11px;font-weight:600;cursor:pointer;transition:.15s}
.btn-primary{background:#00a2ad;color:#fff}.btn-primary:hover{filter:brightness(1.1)}
.btn-secondary{background:transparent;color:#ccc;border:1px solid #3c3c3c}.btn-secondary:hover{background:#3c3c3c}
.btn-ghost{background:transparent;color:#888;border:1px dashed #3c3c3c}.btn-ghost:hover{color:#ccc;border-color:#555}
.summary-bar{padding:10px 16px;font-size:11px;color:#aaa;background:rgba(0,162,173,.05);border-bottom:1px solid #3c3c3c;line-height:1.5}
.content{flex:1;display:flex;overflow:hidden}
.pane{flex:1;display:flex;flex-direction:column;overflow:hidden}
.pane-hd{padding:8px 12px;font-size:11px;font-weight:600;color:#fff;background:#252526;border-bottom:1px solid #3c3c3c}
.pane-body{flex:1;overflow:auto;background:#111}
.pane-body iframe{width:100%;height:100%;border:none;background:#fff}
.raw{padding:10px 12px;font-family:'Cascadia Code','Fira Code','Consolas',monospace;font-size:11px;line-height:1.6;white-space:pre-wrap;color:#ddd}
/* Syntax highlighting colors */
.hl-tag{color:#569cd6}.hl-attr{color:#9cdcfe}.hl-str{color:#ce9178}.hl-cmt{color:#6a9955;font-style:italic}.hl-ent{color:#d7ba7d}.hl-doctype{color:#608b4e}
</style></head><body>
  <div class="header">
    <div class="title">Preview — ${escapeHtml(opts.apiName)}</div>
    <div class="meta">
      <span>${escapeHtml(createdAt)}</span>
      <span class="badge ${
        status === "SUCCEEDED"
          ? "st-ok"
          : status === "FAILED"
            ? "st-err"
            : status === "RUNNING"
              ? "st-run"
              : "st-queue"
      }">${escapeHtml(status)}</span>
    </div>
  </div>

  <div class="actions">
    <button class="btn btn-primary" onclick="send('generateFull')">Generate Full Source</button>
    <button class="btn btn-secondary" onclick="send('regenerate')">Regenerate Preview</button>
    <button class="btn btn-ghost" onclick="send('copy')">Copy HTML</button>
  </div>

  ${extracted.summary ? `<div class="summary-bar">${escapeHtml(extracted.summary)}</div>` : ""}

  <div class="content">
    <div class="pane">
      <div class="pane-hd">Rendered Preview</div>
      <div class="pane-body"><iframe id="preview-frame" sandbox="allow-scripts allow-forms allow-same-origin allow-modals"></iframe></div>
    </div>
    <div class="pane" style="max-width:40%">
      <div class="pane-hd">Raw Output</div>
      <div class="pane-body"><div class="raw" id="raw"></div></div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const sanitized = ${sanitizedJson};
    const raw = ${rawJson};

    function send(type){ vscode.postMessage({ type }); }

    // Simple HTML syntax highlighting
    function highlightHtml(code) {
      // Escape HTML entities first
      let html = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // DOCTYPE
      html = html.replace(/(&lt;!DOCTYPE\\s+[^&]*&gt;)/gi, '<span class="hl-doctype">$1</span>');

      // Comments
      html = html.replace(/(&lt;!--[\\s\\S]*?--&gt;)/g, '<span class="hl-cmt">$1</span>');

      // Tags with attributes
      html = html.replace(/(&lt;\\/?)([a-zA-Z][a-zA-Z0-9-]*)([^&]*?)(&gt;)/g, function(m, open, tag, attrs, close) {
        // Highlight attributes inside
        const highlightedAttrs = attrs.replace(/([a-zA-Z-]+)(=)(&quot;|')(.*?)(\\3)/g,
          '<span class="hl-attr">$1</span>$2<span class="hl-str">$3$4$5</span>');
        return open + '<span class="hl-tag">' + tag + '</span>' + highlightedAttrs + close;
      });

      // Entity references
      html = html.replace(/(&amp;[a-zA-Z0-9]+;)/g, '<span class="hl-ent">$1</span>');

      return html;
    }

    document.getElementById('preview-frame').srcdoc = sanitized;
    document.getElementById('raw').innerHTML = highlightHtml(raw);
  </script>
</body></html>`;
}
