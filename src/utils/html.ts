/** HTML-escape a string for safe insertion into templates. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Crude JSX/TSX → static HTML converter for webview live-preview.
 * Strips imports, exports, type annotations, JS expressions, and event handlers.
 * Converts className → class, htmlFor → for, removes fragments.
 */
export function jsxToHtml(code: string): string {
  let stripped = code
    .replace(/^import\s.*$/gm, "")
    .replace(/^export\s+(default\s+)?/gm, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/interface\s+\w+\s*\{[^}]*\}/gs, "")
    .replace(/type\s+\w+\s*=[^;]+;/g, "");

  const returnMatch = stripped.match(
    /(?:function\s+\w+|const\s+\w+\s*=\s*(?:\([^)]*\)|\w+)\s*(?:=>|:\s*\w+\s*=>))\s*\{?[\s\S]*?return\s*\(([\s\S]*?)\);?\s*\}?\s*;?\s*$/m,
  );
  let html = returnMatch ? returnMatch[1] : stripped;

  html = html
    .replace(/className=/g, "class=")
    .replace(/htmlFor=/g, "for=")
    .replace(/\{[^}]*\}/g, "")
    .replace(/on[A-Z]\w*=[^\s>]*/g, "")
    .replace(/<>|<\/>/g, "")
    .trim();

  return html;
}
