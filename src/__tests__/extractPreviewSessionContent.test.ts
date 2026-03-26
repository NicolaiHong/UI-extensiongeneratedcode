/**
 * Unit tests for extractPreviewSessionContent
 *
 * Test cases from implementation_plan.md:
 * 1. JSON envelope with files array: { summary_md, files: [{ path, content }] }
 * 2. JSON envelope with changes array: { changes: [{ fileName, codeContent }] }
 * 3. Markdown with HTML code fences
 * 4. Direct HTML content
 * 5. Fallback when no HTML found
 */

import {
  extractPreviewSessionContent,
  extractHtmlFromOutput,
} from "../utils/apiWorkflowPanels";
import type { Session } from "../api/sessions.api";

function createMockSession(output: string): Session {
  return {
    id: "test-session-id",
    project_id: "test-project-id",
    api_id: "test-api-id",
    provider: "openai",
    model: "gpt-4o",
    mode: "PREVIEW",
    status: "SUCCEEDED",
    error_message: null,
    output_summary_md: output,
    created_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
  };
}

const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head><title>Test Preview</title></head>
<body>
  <h1>Product Dashboard</h1>
  <script>console.log('test');</script>
</body>
</html>`;

describe("extractPreviewSessionContent", () => {
  describe("Case 1: JSON envelope with files array", () => {
    it("should extract HTML from files array with path field", () => {
      const output = JSON.stringify({
        summary_md: "Generated preview for Product API",
        files: [
          { path: "preview.html", content: SAMPLE_HTML, action: "create" },
        ],
      });

      const session = createMockSession(output);
      const result = extractPreviewSessionContent(session);

      expect(result.previewHtml).toBe(SAMPLE_HTML);
      expect(result.summary).toBe("Generated preview for Product API");
      expect(result.sourceMetadata.source).toBe("files");
      expect(result.sourceMetadata.fileCount).toBe(1);
      expect(result.sourceMetadata.htmlFileName).toBe("preview.html");
    });

    it("should prefer HTML files over other file types", () => {
      const output = JSON.stringify({
        files: [
          { path: "styles.css", content: "body { color: red; }" },
          { path: "preview.html", content: SAMPLE_HTML },
          { path: "app.tsx", content: "const App = () => <div />" },
        ],
      });

      const session = createMockSession(output);
      const result = extractPreviewSessionContent(session);

      expect(result.previewHtml).toBe(SAMPLE_HTML);
      expect(result.sourceMetadata.htmlFileName).toBe("preview.html");
    });

    it("should fall back to first file with content if no HTML file", () => {
      const output = JSON.stringify({
        files: [{ path: "index.jsx", content: "<div>Hello</div>" }],
      });

      const session = createMockSession(output);
      const result = extractPreviewSessionContent(session);

      expect(result.previewHtml).toBe("<div>Hello</div>");
      expect(result.sourceMetadata.htmlFileName).toBe("index.jsx");
    });
  });

  describe("Case 2: JSON envelope with changes array", () => {
    it("should extract HTML from changes array with fileName field", () => {
      const output = JSON.stringify({
        summary: "Preview generated",
        changes: [{ fileName: "preview.html", codeContent: SAMPLE_HTML }],
      });

      const session = createMockSession(output);
      const result = extractPreviewSessionContent(session);

      expect(result.previewHtml).toBe(SAMPLE_HTML);
      expect(result.sourceMetadata.source).toBe("changes");
    });
  });

  describe("Case 3: Markdown with HTML code fences", () => {
    it("should extract HTML from ```html code fence", () => {
      const output = `Here is your preview:

\`\`\`html
${SAMPLE_HTML}
\`\`\`

Done!`;

      const session = createMockSession(output);
      const result = extractPreviewSessionContent(session);

      expect(result.previewHtml).toBe(SAMPLE_HTML);
      expect(result.sourceMetadata.source).toBe("markdown");
      expect(result.summary).not.toContain("```html");
    });

    it("should extract HTML from generic code fence with DOCTYPE", () => {
      const output = `Preview:

\`\`\`
<!DOCTYPE html>
<html><body>Test</body></html>
\`\`\``;

      const session = createMockSession(output);
      const result = extractPreviewSessionContent(session);

      expect(result.previewHtml).toContain("<!DOCTYPE html>");
      expect(result.sourceMetadata.source).toBe("markdown");
    });
  });

  describe("Case 4: Direct HTML content", () => {
    it("should handle direct HTML starting with DOCTYPE", () => {
      const session = createMockSession(SAMPLE_HTML);
      const result = extractPreviewSessionContent(session);

      expect(result.previewHtml).toBe(SAMPLE_HTML);
      expect(result.sourceMetadata.source).toBe("direct");
    });

    it("should handle direct HTML starting with <html>", () => {
      const htmlWithoutDoctype = "<html><body>Test</body></html>";
      const session = createMockSession(htmlWithoutDoctype);
      const result = extractPreviewSessionContent(session);

      expect(result.previewHtml).toBe(htmlWithoutDoctype);
      expect(result.sourceMetadata.source).toBe("direct");
    });
  });

  describe("Case 5: Fallback handling", () => {
    it("should provide fallback message for empty output", () => {
      const session = createMockSession("");
      const result = extractPreviewSessionContent(session);

      expect(result.previewHtml).toContain("No preview HTML returned");
      expect(result.sourceMetadata.source).toBe("fallback");
    });

    it("should provide fallback display for unrecognized content", () => {
      const session = createMockSession(
        "Some random text that is not HTML or JSON",
      );
      const result = extractPreviewSessionContent(session);

      expect(result.previewHtml).toContain("Some random text");
      expect(result.sourceMetadata.source).toBe("fallback");
    });

    it("should handle invalid JSON gracefully", () => {
      const session = createMockSession("{ invalid json }");
      const result = extractPreviewSessionContent(session);

      expect(result.sourceMetadata.source).toBe("fallback");
    });
  });

  describe("Content with </script> tags", () => {
    it("should preserve HTML content with script tags", () => {
      const htmlWithScript = `<!DOCTYPE html>
<html>
<body>
<script>alert('test');</script>
</body>
</html>`;
      const output = JSON.stringify({
        files: [{ path: "preview.html", content: htmlWithScript }],
      });

      const session = createMockSession(output);
      const result = extractPreviewSessionContent(session);

      expect(result.previewHtml).toContain("<script>");
      expect(result.previewHtml).toContain("</script>");
    });
  });
});

describe("extractHtmlFromOutput (legacy)", () => {
  it("should maintain backward compatibility", () => {
    const output = JSON.stringify({
      files: [{ path: "preview.html", content: SAMPLE_HTML }],
    });

    const result = extractHtmlFromOutput(output);

    expect(result.html).toBe(SAMPLE_HTML);
  });
});

describe("Edge cases", () => {
  it("should handle deeply nested paths", () => {
    const output = JSON.stringify({
      files: [
        { path: "src/components/pages/Dashboard.html", content: SAMPLE_HTML },
      ],
    });

    const session = createMockSession(output);
    const result = extractPreviewSessionContent(session);

    expect(result.previewHtml).toBe(SAMPLE_HTML);
  });

  it("should handle various HTML file extensions", () => {
    const output = JSON.stringify({
      files: [{ path: "index.HTM", content: SAMPLE_HTML }],
    });

    const session = createMockSession(output);
    const result = extractPreviewSessionContent(session);

    expect(result.previewHtml).toBe(SAMPLE_HTML);
    expect(result.sourceMetadata.htmlFileName).toBe("index.HTM");
  });

  it("should use summary_md over summary field", () => {
    const output = JSON.stringify({
      summary_md: "Primary summary",
      summary: "Fallback summary",
      files: [{ path: "preview.html", content: SAMPLE_HTML }],
    });

    const session = createMockSession(output);
    const result = extractPreviewSessionContent(session);

    expect(result.summary).toBe("Primary summary");
  });

  it("should handle null output_summary_md", () => {
    const session: Session = {
      id: "test",
      project_id: "test",
      api_id: null,
      provider: "openai",
      model: "gpt-4o",
      mode: "PREVIEW",
      status: "SUCCEEDED",
      error_message: null,
      output_summary_md: null,
      created_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    };

    const result = extractPreviewSessionContent(session);

    expect(result.previewHtml).toContain("No preview HTML returned");
    expect(result.sourceMetadata.source).toBe("fallback");
  });
});
