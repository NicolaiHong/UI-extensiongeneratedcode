/**
 * Session Review Panel
 *
 * A structured webview panel for reviewing completed generation sessions.
 * Shows a source-tree view of generated files, a file content viewer,
 * and action buttons (Download, Apply All, Delete Session).
 *
 * Replaces the old "dump raw JSON in an editor" behavior.
 */

import * as vscode from "vscode";
import * as path from "path";
import { Session, sessionsApi } from "../api/sessions.api";
import { apisApi } from "../api/apis.api";
import {
  GeneratedFile,
  parseSessionOutputToFiles,
  applyFiles,
  buildApplyResultMessage,
  looksLikeSerializedPayload,
} from "./previewPanel";
import { escapeHtml } from "./html";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Show the session review panel for a completed session.
 *
 * Fetches the session data, parses files from output, and opens
 * a rich webview panel with source tree + file viewer.
 */
export async function showSessionReviewPanel(
  projectId: string,
  sessionId: string,
  opts?: {
    apiId?: string;
    enableMarkReady?: boolean;
    onMarkedReady?: () => void;
  },
): Promise<void> {
  // Use API-scoped endpoint if apiId is provided and projectId is empty
  let session: Session;
  if (opts?.apiId && !projectId) {
    session = await apisApi.getSession(opts.apiId, sessionId);
  } else {
    session = await sessionsApi.getById(projectId, sessionId);
  }

  // Parse files from the session output
  const files = session.output_summary_md
    ? parseSessionOutputToFiles(session.output_summary_md)
    : [];

  // Determine display summary — hide if it looks like serialized data
  let summaryText = "";
  if (session.output_summary_md) {
    if (
      files.length > 0 &&
      looksLikeSerializedPayload(session.output_summary_md)
    ) {
      // Try to extract summary_md from the JSON envelope
      try {
        const envelope = JSON.parse(session.output_summary_md);
        if (
          envelope.summary_md &&
          !looksLikeSerializedPayload(envelope.summary_md)
        ) {
          summaryText = envelope.summary_md;
        }
      } catch {
        // Not JSON — just suppress it
      }
    } else if (files.length === 0) {
      // Legacy session or plain markdown — show as-is
      summaryText = session.output_summary_md;
    } else {
      // Has files, not serialized — show the summary
      summaryText = session.output_summary_md;
    }
  }

  const panel = vscode.window.createWebviewPanel(
    "uigenai-session-review",
    `Session: ${session.provider}/${session.model}`,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  // Handle messages from the webview
  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      switch (msg.type) {
        case "applyAll": {
          const result = await applyFiles(files);
          const status = buildApplyResultMessage(result, files.length);
          if (status.level === "success") {
            vscode.window.showInformationMessage(status.message);
          } else {
            vscode.window.showErrorMessage(status.message);
          }
          panel.webview.postMessage({ type: "status", ...status });
          break;
        }

        case "markReady": {
          if (!opts?.enableMarkReady || !opts?.apiId) {
            panel.webview.postMessage({
              type: "status",
              level: "error",
              message: "Mark Ready to Deploy is unavailable for this session.",
            });
            break;
          }
          try {
            await apisApi.markReadyToDeploy(opts.apiId);
            panel.webview.postMessage({
              type: "status",
              level: "success",
              message: "API marked Ready to Deploy.",
            });
            vscode.window.showInformationMessage("API marked Ready to Deploy.");
            opts.onMarkedReady?.();
            vscode.commands.executeCommand("uigenai.refreshSidebar");
          } catch (e: any) {
            const err = e?.message || e?.response?.data?.message || String(e);
            panel.webview.postMessage({
              type: "status",
              level: "error",
              message: `Failed: ${err}`,
            });
          }
          break;
        }

        case "download": {
          if (files.length === 0) {
            vscode.window.showWarningMessage("No files to download.");
            break;
          }

          // Choose save location
          const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(
              `session-${session.provider}-${session.model}-${sessionId.slice(0, 8)}.zip`,
            ),
            filters: { "Zip Archive": ["zip"] },
          });

          if (!saveUri) {
            break;
          }

          try {
            const JSZip = (await import("jszip")).default;
            const zip = new JSZip();
            for (const file of files) {
              zip.file(file.path, file.content);
            }
            const content = await zip.generateAsync({ type: "uint8array" });
            await vscode.workspace.fs.writeFile(saveUri, content);
            vscode.window.showInformationMessage(
              `Downloaded ${files.length} file(s) to ${saveUri.fsPath}`,
            );
          } catch (e: any) {
            vscode.window.showErrorMessage(
              `Download failed: ${e.message || e}`,
            );
          }
          break;
        }

        case "deleteSession": {
          const answer = await vscode.window.showWarningMessage(
            `Delete this session? This action cannot be undone.`,
            { modal: true },
            "Delete",
          );
          if (answer === "Delete") {
            // Use API-scoped endpoint if apiId is provided and projectId is empty
            if (opts?.apiId && !projectId) {
              await apisApi.deleteSession(opts.apiId, sessionId);
            } else {
              await sessionsApi.delete(projectId, sessionId);
            }
            vscode.window.showInformationMessage("Session deleted.");
            panel.dispose();
            // Refresh the sidebar to reflect deletion
            vscode.commands.executeCommand("uigenai.refreshSidebar");
          }
          break;
        }
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Error: ${e.message || e}`);
    }
  });

  panel.webview.html = buildReviewHtml(
    session,
    files,
    summaryText,
    opts?.enableMarkReady ?? false,
  );
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

interface TreeNode {
  name: string;
  fullPath: string;
  isFile: boolean;
  children: TreeNode[];
  fileIndex?: number;
}

function buildFileTree(files: GeneratedFile[]): TreeNode {
  const root: TreeNode = {
    name: "",
    fullPath: "",
    isFile: false,
    children: [],
  };

  for (let i = 0; i < files.length; i++) {
    const parts = files[i].path.split("/");
    let current = root;

    for (let j = 0; j < parts.length; j++) {
      const part = parts[j];
      const isLast = j === parts.length - 1;
      const fullPath = parts.slice(0, j + 1).join("/");

      let child = current.children.find(
        (c) => c.name === part && c.isFile === isLast,
      );
      if (!child) {
        child = {
          name: part,
          fullPath,
          isFile: isLast,
          children: [],
          fileIndex: isLast ? i : undefined,
        };
        current.children.push(child);
      }
      current = child;
    }
  }

  // Sort: folders first, then alphabetic
  function sortTree(node: TreeNode) {
    node.children.sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortTree);
  }
  sortTree(root);

  return root;
}

function renderTreeHtml(node: TreeNode, depth: number = 0): string {
  if (node.name === "" && !node.isFile) {
    // Root node — just render children
    return node.children.map((c) => renderTreeHtml(c, 0)).join("");
  }

  const indent = depth * 16;
  const icon = node.isFile ? getFileIcon(node.name) : "📁";

  if (node.isFile) {
    return `<div class="tree-item tree-file" style="padding-left:${indent + 8}px" onclick="selectFile(${node.fileIndex})" data-idx="${node.fileIndex}">
      <span class="tree-icon">${icon}</span>
      <span class="tree-name">${escapeHtml(node.name)}</span>
    </div>`;
  }

  const childrenHtml = node.children
    .map((c) => renderTreeHtml(c, depth + 1))
    .join("");
  return `<div class="tree-folder">
    <div class="tree-item tree-dir" style="padding-left:${indent + 8}px" onclick="toggleFolder(this)">
      <span class="tree-arrow">▶</span>
      <span class="tree-icon">${icon}</span>
      <span class="tree-name">${escapeHtml(node.name)}</span>
    </div>
    <div class="tree-children open">${childrenHtml}</div>
  </div>`;
}

function getFileIcon(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "🟦",
    ".tsx": "⚛️",
    ".js": "🟨",
    ".jsx": "⚛️",
    ".css": "🎨",
    ".scss": "🎨",
    ".html": "🌐",
    ".json": "📋",
    ".md": "📝",
    ".svg": "🖼️",
    ".png": "🖼️",
    ".jpg": "🖼️",
    ".yml": "⚙️",
    ".yaml": "⚙️",
    ".env": "🔑",
    ".lock": "🔒",
  };
  return map[ext] || "📄";
}

function buildReviewHtml(
  session: Session,
  files: GeneratedFile[],
  summary: string,
  canMarkReady: boolean,
): string {
  const hasFiles = files.length > 0;
  const tree = hasFiles ? buildFileTree(files) : null;
  const treeHtml = tree ? renderTreeHtml(tree) : "";

  const createdDate = new Date(session.created_at).toLocaleString();
  const statusClass =
    session.status === "SUCCEEDED"
      ? "st-ok"
      : session.status === "FAILED"
        ? "st-err"
        : session.status === "RUNNING"
          ? "st-run"
          : "st-queue";

  // Sanitize file data for the webview
  const filesJson = hasFiles
    ? JSON.stringify(
        files.map((f) => ({
          name: f.path,
          content: f.content,
          lang: f.lang,
          lines: f.lines,
        })),
      )
        .replace(/<\//g, "<\\/")
        .replace(/<!--/g, "<\\!--")
    : "[]";

  return /*html*/ `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;background:#1e1e1e;color:#ccc;height:100vh;display:flex;flex-direction:column;overflow:hidden}

/* Header */
.header{background:#252526;border-bottom:1px solid #3c3c3c;padding:12px 16px;flex-shrink:0}
.header-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.header h2{font-size:14px;font-weight:700;color:#fff}
.status{font-size:10px;padding:2px 8px;border-radius:12px;font-weight:600;text-transform:uppercase}
.st-ok{background:rgba(78,201,176,.15);color:#4ec9b0}
.st-err{background:rgba(244,71,71,.15);color:#f44747}
.st-run{background:rgba(0,122,204,.15);color:#4fc1ff}
.st-queue{background:rgba(220,220,170,.15);color:#dcdcaa}
.meta{font-size:11px;color:#888;display:flex;gap:16px;flex-wrap:wrap}
.meta span{display:flex;align-items:center;gap:4px}

/* Action bar */
.actions{display:flex;gap:6px;padding:8px 16px;border-bottom:1px solid #3c3c3c;background:#252526;flex-shrink:0}
.btn{padding:5px 12px;border-radius:4px;border:none;font-size:11px;font-weight:600;cursor:pointer;transition:.15s}
.btn-primary{background:#00a2ad;color:#fff}.btn-primary:hover{filter:brightness(1.2)}
.btn-secondary{background:transparent;color:#ccc;border:1px solid #3c3c3c}.btn-secondary:hover{background:#3c3c3c}
.btn-danger{background:transparent;color:#f44747;border:1px solid rgba(244,71,71,.3)}.btn-danger:hover{background:rgba(244,71,71,.15)}

/* Summary */
.summary{padding:10px 16px;font-size:11px;color:#aaa;border-bottom:1px solid #3c3c3c;background:#1e1e2e;max-height:120px;overflow-y:auto;white-space:pre-wrap;line-height:1.5}

/* Main layout */
.main{flex:1;display:flex;overflow:hidden;min-height:0}

/* Tree panel */
.tree-panel{width:260px;border-right:1px solid #3c3c3c;background:#252526;overflow-y:auto;flex-shrink:0}
.tree-panel-hd{padding:8px 12px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#888;border-bottom:1px solid #3c3c3c;background:#1e1e1e}
.tree-item{display:flex;align-items:center;gap:6px;padding:3px 8px;cursor:pointer;font-size:11px;border-radius:0;transition:background .1s}
.tree-item:hover{background:rgba(255,255,255,.05)}
.tree-item.selected{background:rgba(0,162,173,.2);color:#fff}
.tree-icon{font-size:12px;flex-shrink:0}
.tree-arrow{font-size:8px;width:12px;text-align:center;transition:transform .15s;flex-shrink:0}
.tree-arrow.open{transform:rotate(90deg)}
.tree-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tree-children{overflow:hidden;max-height:2000px;transition:max-height .2s}
.tree-children.collapsed{max-height:0}

/* Viewer panel */
.viewer-panel{flex:1;display:flex;flex-direction:column;overflow:hidden;background:#1e1e1e}
.viewer-hd{padding:8px 12px;font-size:11px;font-weight:600;color:#fff;background:#252526;border-bottom:1px solid #3c3c3c;display:flex;align-items:center;justify-content:space-between}
.viewer-meta{font-size:10px;color:#888;font-weight:400}
.viewer-body{flex:1;overflow:auto;padding:0}
.viewer-body pre{margin:0;padding:14px 16px;font-family:'Cascadia Code','Fira Code','Consolas',monospace;font-size:11px;line-height:1.6;color:rgba(255,255,255,.85);white-space:pre;tab-size:2}
.viewer-empty{display:flex;align-items:center;justify-content:center;height:100%;color:#555;font-size:13px}

/* Fallback view (no files) */
.fallback{flex:1;padding:20px;overflow-y:auto}
.fallback-content{font-size:12px;line-height:1.7;color:#aaa;white-space:pre-wrap;max-width:800px}

/* Status message */
.status-msg{padding:8px 16px;font-size:11px;font-weight:600;display:none}
.status-msg.show{display:block}
.status-msg.success{background:rgba(78,201,176,.1);color:#4ec9b0;border-bottom:1px solid rgba(78,201,176,.2)}
.status-msg.error{background:rgba(244,71,71,.1);color:#f44747;border-bottom:1px solid rgba(244,71,71,.2)}
</style></head><body>

<!-- Status message -->
<div class="status-msg" id="statusMsg"></div>

<!-- Header -->
<div class="header">
  <div class="header-top">
    <h2>${escapeHtml(session.provider)}/${escapeHtml(session.model)}</h2>
    <span class="status ${statusClass}">${escapeHtml(session.status)}</span>
  </div>
  <div class="meta">
    <span>📅 ${escapeHtml(createdDate)}</span>
    ${hasFiles ? `<span>📁 ${files.length} file${files.length !== 1 ? "s" : ""}</span>` : ""}
    ${session.error_message ? `<span style="color:#f44747">⚠️ ${escapeHtml(session.error_message)}</span>` : ""}
  </div>
</div>

<!-- Actions -->
${
  hasFiles
    ? `
<div class="actions">
  <button class="btn btn-primary" onclick="action('applyAll')">📁 Apply All</button>
  <button class="btn btn-secondary" onclick="action('download')">⬇️ Download ZIP</button>
  ${canMarkReady && session.status === "SUCCEEDED" ? `<button class="btn btn-primary" style="background:#4ec9b0;color:#0a0a0a" onclick="action('markReady')">✅ Mark Ready to Deploy</button>` : ""}
  <button class="btn btn-danger" onclick="action('deleteSession')">🗑️ Delete Session</button>
</div>
`
    : `
<div class="actions">
  ${canMarkReady && session.status === "SUCCEEDED" ? `<button class="btn btn-primary" style="background:#4ec9b0;color:#0a0a0a" onclick="action('markReady')">✅ Mark Ready to Deploy</button>` : ""}
  <button class="btn btn-danger" onclick="action('deleteSession')">🗑️ Delete Session</button>
</div>
`
}

${summary && !hasFiles ? `<div class="summary">${escapeHtml(summary)}</div>` : ""}
${summary && hasFiles ? `<div class="summary">${escapeHtml(summary)}</div>` : ""}

<!-- Main content -->
${
  hasFiles
    ? `
<div class="main">
  <!-- Tree -->
  <div class="tree-panel">
    <div class="tree-panel-hd">Files</div>
    ${treeHtml}
  </div>

  <!-- Viewer -->
  <div class="viewer-panel">
    <div class="viewer-hd" id="viewerHd" style="display:none">
      <span id="viewerFileName"></span>
      <span class="viewer-meta" id="viewerMeta"></span>
    </div>
    <div class="viewer-body" id="viewerBody">
      <div class="viewer-empty">Select a file from the tree to view its contents</div>
    </div>
  </div>
</div>
`
    : `
<div class="fallback">
  ${session.status === "SUCCEEDED" ? `<div class="fallback-content">${escapeHtml(session.output_summary_md || "No output available.")}</div>` : ""}
  ${session.status === "FAILED" ? `<div class="fallback-content" style="color:#f44747">${escapeHtml(session.error_message || "Generation failed.")}</div>` : ""}
  ${session.status === "RUNNING" ? `<div class="fallback-content">Generation is still running. Check back shortly.</div>` : ""}
  ${session.status === "QUEUED" ? `<div class="fallback-content">This session is queued and hasn't started yet.</div>` : ""}
</div>
`
}

<script>
const vscode = acquireVsCodeApi();
const files = ${filesJson};
let selectedIdx = -1;

function action(type) {
  vscode.postMessage({ type });
}

function selectFile(idx) {
  if (idx < 0 || idx >= files.length) return;
  selectedIdx = idx;
  const file = files[idx];

  // Update tree selection
  document.querySelectorAll('.tree-file').forEach(el => el.classList.remove('selected'));
  const sel = document.querySelector('[data-idx="' + idx + '"]');
  if (sel) sel.classList.add('selected');

  // Update viewer
  const hd = document.getElementById('viewerHd');
  const body = document.getElementById('viewerBody');
  hd.style.display = 'flex';
  document.getElementById('viewerFileName').textContent = file.name;
  document.getElementById('viewerMeta').textContent = file.lang + ' · ' + file.lines + ' lines';
  body.innerHTML = '<pre>' + escapeHtml(file.content) + '</pre>';
}

function toggleFolder(el) {
  const children = el.nextElementSibling;
  const arrow = el.querySelector('.tree-arrow');
  if (children) {
    children.classList.toggle('collapsed');
    arrow.classList.toggle('open');
  }
}

function escapeHtml(s) {
  return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';
}

// Listen for status messages
window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'status') {
    const el = document.getElementById('statusMsg');
    el.textContent = msg.message;
    el.className = 'status-msg show ' + msg.level;
    setTimeout(() => { el.className = 'status-msg'; }, 5000);
  }
});

// Auto-select first file
${hasFiles && files.length > 0 ? "selectFile(0);" : ""}
</script>
</body></html>`;
}
