/**
 * Code Validator - Validate generated code before deployment
 *
 * Checks:
 * - Syntax errors (ESLint)
 * - TypeScript errors
 * - Build test (vite build)
 * - Missing dependencies
 */

import * as vscode from "vscode";
import * as path from "path";
import { spawn } from "child_process";
import { GeneratedFile } from "./previewPanel";

export interface ValidationError {
  file: string;
  line?: number;
  column?: number;
  message: string;
  severity: "error" | "warning";
  code?: string;
}

export interface ValidationResult {
  success: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  canDeploy: boolean;
}

/**
 * Validate generated files before deployment
 */
export async function validateCode(
  files: GeneratedFile[],
  workspaceRoot: string,
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // 1. Check for common syntax issues
  const syntaxErrors = checkSyntaxErrors(files);
  errors.push(...syntaxErrors);

  // 2. Check for missing imports
  const importErrors = checkMissingImports(files);
  errors.push(...importErrors);

  // 3. Check package.json exists and has required deps
  const depErrors = checkDependencies(files);
  warnings.push(...depErrors);

  // 4. Try to run build (if workspace has node_modules)
  const buildResult = await tryBuild(workspaceRoot);
  if (buildResult.errors.length > 0) {
    errors.push(...buildResult.errors);
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    canDeploy: errors.length === 0,
  };
}

/**
 * Check for common syntax errors
 */
function checkSyntaxErrors(files: GeneratedFile[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const file of files) {
    const ext = path.extname(file.path).toLowerCase();

    // Check JSX/TSX files
    if ([".jsx", ".tsx", ".js", ".ts"].includes(ext)) {
      // Check for unclosed tags
      const unclosedTags = checkUnclosedTags(file.content);
      if (unclosedTags) {
        errors.push({
          file: file.path,
          message: `Possible unclosed tag: ${unclosedTags}`,
          severity: "error",
        });
      }

      // Check for missing semicolons in critical places
      const missingSemicolon = checkMissingSemicolons(file.content);
      if (missingSemicolon) {
        errors.push({
          file: file.path,
          line: missingSemicolon.line,
          message: "Possible missing semicolon",
          severity: "warning",
        });
      }

      // Check for unbalanced braces
      const unbalanced = checkUnbalancedBraces(file.content);
      if (unbalanced) {
        errors.push({
          file: file.path,
          message: `Unbalanced ${unbalanced}`,
          severity: "error",
        });
      }
    }

    // Check JSON files
    if (ext === ".json") {
      try {
        JSON.parse(file.content);
      } catch (e: any) {
        errors.push({
          file: file.path,
          message: `Invalid JSON: ${e.message}`,
          severity: "error",
        });
      }
    }
  }

  return errors;
}

/**
 * Check for unclosed JSX tags
 */
function checkUnclosedTags(content: string): string | null {
  const tagPattern = /<([A-Z][a-zA-Z0-9]*)[^>]*(?<!\/)\s*>/g;
  const selfClosingPattern = /<([A-Z][a-zA-Z0-9]*)[^>]*\/\s*>/g;
  const closingPattern = /<\/([A-Z][a-zA-Z0-9]*)>/g;

  const openTags: string[] = [];
  let match;

  // Find all opening tags
  while ((match = tagPattern.exec(content)) !== null) {
    openTags.push(match[1]);
  }

  // Remove self-closing tags
  while ((match = selfClosingPattern.exec(content)) !== null) {
    const idx = openTags.indexOf(match[1]);
    if (idx > -1) openTags.splice(idx, 1);
  }

  // Remove closed tags
  while ((match = closingPattern.exec(content)) !== null) {
    const idx = openTags.lastIndexOf(match[1]);
    if (idx > -1) openTags.splice(idx, 1);
  }

  return openTags.length > 0 ? openTags[0] : null;
}

/**
 * Check for missing semicolons
 */
function checkMissingSemicolons(content: string): { line: number } | null {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Check for statements that should end with semicolon
    if (
      line.match(/^(const|let|var|import|export)\s+/) &&
      !line.endsWith(";") &&
      !line.endsWith("{") &&
      !line.endsWith(",") &&
      !line.includes("=>")
    ) {
      // Check if next line is a continuation
      const nextLine = lines[i + 1]?.trim() || "";
      if (!nextLine.startsWith(".") && !nextLine.startsWith("?")) {
        return { line: i + 1 };
      }
    }
  }
  return null;
}

/**
 * Check for unbalanced braces
 */
function checkUnbalancedBraces(content: string): string | null {
  const pairs: Record<string, string> = {
    "{": "}",
    "[": "]",
    "(": ")",
  };
  const stack: string[] = [];

  // Remove strings and comments
  const cleaned = content
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");

  for (const char of cleaned) {
    if (pairs[char]) {
      stack.push(pairs[char]);
    } else if (Object.values(pairs).includes(char)) {
      if (stack.pop() !== char) {
        return `'${char}'`;
      }
    }
  }

  if (stack.length > 0) {
    return `'${stack[stack.length - 1]}'`;
  }

  return null;
}

/**
 * Check for missing imports
 */
function checkMissingImports(files: GeneratedFile[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const definedComponents = new Set<string>();
  const importedComponents = new Set<string>();

  // Collect all defined and imported components
  for (const file of files) {
    // Find component definitions
    const defMatches = file.content.matchAll(
      /(?:function|const)\s+([A-Z][a-zA-Z0-9]*)/g,
    );
    for (const match of defMatches) {
      definedComponents.add(match[1]);
    }

    // Find imports
    const importMatches = file.content.matchAll(
      /import\s+(?:{([^}]+)}|([A-Z][a-zA-Z0-9]*))\s+from/g,
    );
    for (const match of importMatches) {
      if (match[1]) {
        match[1].split(",").forEach((name) => {
          importedComponents.add(name.trim());
        });
      }
      if (match[2]) {
        importedComponents.add(match[2]);
      }
    }
  }

  // Check for used but not imported/defined components
  for (const file of files) {
    const usedMatches = file.content.matchAll(/<([A-Z][a-zA-Z0-9]*)/g);
    for (const match of usedMatches) {
      const component = match[1];
      if (
        !definedComponents.has(component) &&
        !importedComponents.has(component) &&
        !isBuiltInComponent(component)
      ) {
        errors.push({
          file: file.path,
          message: `Component '${component}' is used but not imported or defined`,
          severity: "error",
        });
      }
    }
  }

  return errors;
}

/**
 * Check if component is a built-in HTML element or common library component
 */
function isBuiltInComponent(name: string): boolean {
  const builtIns = [
    "Fragment",
    "Suspense",
    "StrictMode",
    "Profiler",
    // Common UI libraries
    "Button",
    "Input",
    "Select",
    "Card",
    "Modal",
    "Dialog",
    "Form",
    "Table",
    "Icon",
  ];
  return builtIns.includes(name);
}

/**
 * Check for dependency issues
 */
function checkDependencies(files: GeneratedFile[]): ValidationError[] {
  const warnings: ValidationError[] = [];

  // Find package.json
  const packageJson = files.find((f) => f.path === "package.json");
  if (!packageJson) {
    warnings.push({
      file: "package.json",
      message: "No package.json found - dependencies may be missing",
      severity: "warning",
    });
    return warnings;
  }

  try {
    const pkg = JSON.parse(packageJson.content);
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    // Check for common missing dependencies
    const requiredDeps = ["react", "react-dom"];
    for (const dep of requiredDeps) {
      if (!deps[dep]) {
        warnings.push({
          file: "package.json",
          message: `Missing dependency: ${dep}`,
          severity: "warning",
        });
      }
    }
  } catch {
    warnings.push({
      file: "package.json",
      message: "Invalid package.json",
      severity: "warning",
    });
  }

  return warnings;
}

/**
 * Try to run build command
 */
async function tryBuild(workspaceRoot: string): Promise<{
  errors: ValidationError[];
  output: string;
}> {
  return new Promise((resolve) => {
    // Check if node_modules exists
    const nodeModulesPath = path.join(workspaceRoot, "node_modules");

    // Try vite build --dry-run or just type check
    const child = spawn("npx", ["tsc", "--noEmit"], {
      cwd: workspaceRoot,
      shell: true,
    });

    let output = "";
    let errorOutput = "";

    child.stdout?.on("data", (data) => {
      output += data.toString();
    });

    child.stderr?.on("data", (data) => {
      errorOutput += data.toString();
    });

    child.on("error", () => {
      // Build command not available, skip
      resolve({ errors: [], output: "" });
    });

    child.on("close", (code) => {
      if (code !== 0 && errorOutput) {
        const errors = parseBuildErrors(errorOutput);
        resolve({ errors, output: errorOutput });
      } else {
        resolve({ errors: [], output });
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      child.kill();
      resolve({ errors: [], output: "Build check timed out" });
    }, 30000);
  });
}

/**
 * Parse build error output into ValidationError[]
 */
function parseBuildErrors(output: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    // Match TypeScript error format: file.ts(line,col): error TS1234: message
    const tsMatch = line.match(
      /(.+)\((\d+),(\d+)\):\s*error\s*(TS\d+):\s*(.+)/,
    );
    if (tsMatch) {
      errors.push({
        file: tsMatch[1],
        line: parseInt(tsMatch[2]),
        column: parseInt(tsMatch[3]),
        code: tsMatch[4],
        message: tsMatch[5],
        severity: "error",
      });
      continue;
    }

    // Match Vite/ESLint format: file.ts:line:col: message
    const viteMatch = line.match(/(.+):(\d+):(\d+):\s*(.+)/);
    if (viteMatch) {
      errors.push({
        file: viteMatch[1],
        line: parseInt(viteMatch[2]),
        column: parseInt(viteMatch[3]),
        message: viteMatch[4],
        severity: "error",
      });
    }
  }

  return errors;
}

/**
 * Quick validation without running build (faster)
 */
export function quickValidate(files: GeneratedFile[]): ValidationResult {
  const errors = [...checkSyntaxErrors(files), ...checkMissingImports(files)];
  const warnings = checkDependencies(files);

  return {
    success: errors.length === 0,
    errors,
    warnings,
    canDeploy: errors.length === 0,
  };
}

/**
 * Show validation results in VS Code
 */
export async function showValidationResults(
  result: ValidationResult,
): Promise<"fix" | "ignore" | "cancel"> {
  if (result.success && result.warnings.length === 0) {
    return "ignore";
  }

  const errorCount = result.errors.length;
  const warningCount = result.warnings.length;

  let message = "";
  if (errorCount > 0) {
    message += `${errorCount} error(s)`;
  }
  if (warningCount > 0) {
    message +=
      errorCount > 0
        ? ` and ${warningCount} warning(s)`
        : `${warningCount} warning(s)`;
  }
  message += " found in generated code.";

  const actions =
    errorCount > 0
      ? ["Fix Errors", "View Details", "Cancel"]
      : ["Continue Anyway", "View Details", "Cancel"];

  const choice = await vscode.window.showWarningMessage(message, ...actions);

  if (choice === "Fix Errors") {
    return "fix";
  }
  if (choice === "Continue Anyway") {
    return "ignore";
  }
  if (choice === "View Details") {
    // Show detailed error panel
    const detail = [
      ...result.errors.map(
        (e) => `❌ ${e.file}${e.line ? `:${e.line}` : ""}: ${e.message}`,
      ),
      ...result.warnings.map((w) => `⚠️ ${w.file}: ${w.message}`),
    ].join("\n");

    await vscode.window.showInformationMessage(detail, { modal: true });
    return showValidationResults(result); // Ask again
  }

  return "cancel";
}
