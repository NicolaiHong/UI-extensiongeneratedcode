import * as vscode from "vscode";
import { Session } from "../api/sessions.api";
import { escapeHtml } from "./html";

interface PreviewReviewOptions {
  apiName: string;
  session: Session;
  onGenerateFull?: () => Promise<void> | void;
  onRegenerate?: () => Promise<void> | void;
}

function stripScripts(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "");
}

/**
 * Extract HTML from markdown code blocks.
 * Returns the HTML content if found, otherwise null.
 */
function extractHtmlFromMarkdown(text: string): string | null {
  if (!text) return null;

  // Pattern 1: ```html\n...\n```
  const htmlBlockMatch = text.match(/```html\s*\n([\s\S]*?)\n```/i);
  if (htmlBlockMatch) {
    return htmlBlockMatch[1].trim();
  }

  // Pattern 2: ```\n<!DOCTYPE...\n```
  const doctypeBlockMatch = text.match(/```\s*\n(<!DOCTYPE[\s\S]*?)\n```/i);
  if (doctypeBlockMatch) {
    return doctypeBlockMatch[1].trim();
  }

  // Pattern 3: Direct HTML (no code block)
  const trimmed = text.trim();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
    return trimmed;
  }

  return null;
}

/**
 * Get file path from various field names used by AI.
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
 * Extract HTML content from session output.
 * The output may be:
 * 1. A JSON object with files array containing HTML
 * 2. A JSON object with summary_md containing markdown with HTML code block
 * 3. A JSON object with changes array
 * 4. Raw HTML directly
 * 5. Markdown with HTML code block
 */
export function extractHtmlFromOutput(output: string): {
  html: string;
  summary: string;
} {
  if (!output?.trim()) {
    return { html: "<p>No preview HTML returned.</p>", summary: "" };
  }

  const trimmed = output.trim();

  // Try to parse as JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const summaryText = parsed.summary_md || parsed.summary || "";

      // Case 1: { files: [...] } - look for HTML file
      if (Array.isArray(parsed.files) && parsed.files.length > 0) {
        // Find HTML file first
        const htmlFile = parsed.files.find((f: any) =>
          isHtmlFile(getFilePath(f)),
        );
        if (htmlFile) {
          const content = getFileContent(htmlFile);
          if (content) {
            return { html: content, summary: summaryText };
          }
        }
        // Fallback to first file with content
        for (const file of parsed.files) {
          const content = getFileContent(file);
          if (content) {
            return { html: content, summary: summaryText };
          }
        }
      }

      // Case 2: { changes: [...] } - same logic
      if (Array.isArray(parsed.changes) && parsed.changes.length > 0) {
        const htmlFile = parsed.changes.find((f: any) =>
          isHtmlFile(getFilePath(f)),
        );
        if (htmlFile) {
          const content = getFileContent(htmlFile);
          if (content) {
            return { html: content, summary: summaryText };
          }
        }
        for (const file of parsed.changes) {
          const content = getFileContent(file);
          if (content) {
            return { html: content, summary: summaryText };
          }
        }
      }

      // Case 3: { codeContent: "..." } directly
      if (parsed.codeContent) {
        return { html: parsed.codeContent, summary: summaryText };
      }

      // Case 4: { html: "..." }
      if (parsed.html) {
        return { html: parsed.html, summary: summaryText };
      }

      // Case 5: summary_md contains HTML in markdown code block
      if (summaryText) {
        const extractedHtml = extractHtmlFromMarkdown(summaryText);
        if (extractedHtml) {
          // Remove the code block from summary for display
          const cleanSummary = summaryText
            .replace(/```html\s*\n[\s\S]*?\n```/gi, "")
            .replace(/```\s*\n<!DOCTYPE[\s\S]*?\n```/gi, "")
            .trim();
          return { html: extractedHtml, summary: cleanSummary };
        }
      }
    } catch {
      // Not valid JSON, continue to other methods
    }
  }

  // Try to extract HTML from markdown code block
  const extractedHtml = extractHtmlFromMarkdown(trimmed);
  if (extractedHtml) {
    const cleanSummary = trimmed
      .replace(/```html\s*\n[\s\S]*?\n```/gi, "")
      .replace(/```\s*\n<!DOCTYPE[\s\S]*?\n```/gi, "")
      .trim();
    return { html: extractedHtml, summary: cleanSummary };
  }

  // Treat as raw HTML
  return { html: trimmed, summary: "" };
}

export function showPreviewReviewPanel(opts: PreviewReviewOptions): void {
  const panel = vscode.window.createWebviewPanel(
    "uigenai-preview-review",
    `Preview — ${opts.apiName}`,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  const rawOutput = opts.session.output_summary_md || "";
  const { html, summary } = extractHtmlFromOutput(rawOutput);
  const raw = html;
  const sanitized = stripScripts(raw);
  const createdAt = new Date(opts.session.created_at).toLocaleString();
  const status = opts.session.status;

  panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.type) {
      case "copy":
        await vscode.env.clipboard.writeText(raw);
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

  ${summary ? `<div class="summary-bar">${escapeHtml(summary)}</div>` : ""}

  <div class="content">
    <div class="pane">
      <div class="pane-hd">Rendered Preview</div>
      <div class="pane-body"><iframe id="preview-frame" sandbox="allow-scripts allow-forms"></iframe></div>
    </div>
    <div class="pane" style="max-width:40%">
      <div class="pane-hd">Raw Output</div>
      <div class="pane-body"><div class="raw" id="raw"></div></div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const sanitized = ${JSON.stringify(
      sanitized.replace(/<\/(script)/gi, "<\\/$1"),
    )};
    const raw = ${JSON.stringify(raw.replace(/<\/(script)/gi, "<\\/$1"))};

    function send(type){ vscode.postMessage({ type }); }

    document.getElementById('preview-frame').srcdoc = sanitized;
    document.getElementById('raw').innerText = raw;
  </script>
</body></html>`;
}
