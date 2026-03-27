/**
 * GitHub Pages Deployment Provider
 * 
 * Implements deployment to GitHub Pages by:
 * 1. Creating/updating a repository
 * 2. Pushing files to gh-pages branch
 * 3. Enabling GitHub Pages
 */

import * as vscode from "vscode";
import {
  BaseDeploymentProvider,
  IDeploymentProvider,
  registerProvider,
} from "./base";
import {
  DeploymentProvider,
  DeploymentResult,
  DeploymentState,
  DeploymentProgress,
  GeneratedFile,
  ProviderConfig,
  PrerequisiteResult,
  ProviderStatusResult,
} from "../types";

const GITHUB_API_BASE = "https://api.github.com";

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
}

interface GitHubPagesInfo {
  url: string;
  status: "built" | "building" | "errored" | null;
  source?: {
    branch: string;
    path: string;
  };
}

interface GitHubBlob {
  sha: string;
  url: string;
}

interface GitHubTree {
  sha: string;
  url: string;
}

interface GitHubCommit {
  sha: string;
  url: string;
}

interface GitHubRef {
  ref: string;
  object: {
    sha: string;
  };
}

export class GitHubPagesDeploymentProvider
  extends BaseDeploymentProvider
  implements IDeploymentProvider
{
  readonly provider = DeploymentProvider.GITHUB_PAGES;
  readonly name = "GitHub Pages";

  async checkStatus(config: ProviderConfig): Promise<ProviderStatusResult> {
    const token = this.getToken(config);

    if (!token) {
      return {
        available: true,
        authenticated: false,
        tokenValid: false,
        error: "GitHub token not configured",
      };
    }

    try {
      const response = await fetch(`${GITHUB_API_BASE}/user`, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (response.ok) {
        return {
          available: true,
          authenticated: true,
          tokenValid: true,
        };
      } else {
        const error = await response.text();
        return {
          available: true,
          authenticated: false,
          tokenValid: false,
          error: `Invalid token: ${error}`,
        };
      }
    } catch (e: any) {
      return {
        available: false,
        authenticated: false,
        tokenValid: false,
        error: `Connection error: ${e.message}`,
      };
    }
  }

  async validatePrerequisites(
    files: GeneratedFile[],
    config: ProviderConfig
  ): Promise<PrerequisiteResult> {
    const commonResult = this.validateCommonPrerequisites(files, config);
    const errors = [...commonResult.errors];
    const warnings = [...commonResult.warnings];

    // Check for GitHub token
    const token = this.getToken(config);
    if (!token) {
      errors.push(
        "GitHub token not configured. Set it in Settings > UI Gen AI > GitHub Token"
      );
    }

    // Check for index.html (required for GitHub Pages)
    const hasIndexHtml = files.some(
      (f) => f.path === "index.html" || f.path === "/index.html"
    );
    if (!hasIndexHtml) {
      warnings.push(
        "No root index.html found. GitHub Pages requires index.html. Build output may need to be deployed instead of source."
      );
    }

    // Check for .nojekyll (recommended for Vite/React apps)
    const hasNoJekyll = files.some((f) => f.path.includes(".nojekyll"));
    if (!hasNoJekyll) {
      warnings.push(
        "Consider adding .nojekyll file to prevent Jekyll processing."
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  async createDeployment(
    files: GeneratedFile[],
    config: ProviderConfig,
    onProgress?: (progress: DeploymentProgress) => void
  ): Promise<DeploymentResult> {
    const token = this.getToken(config);
    if (!token) {
      return this.failedResult("GitHub token not configured", "TOKEN_MISSING");
    }

    try {
      // Step 1: Validate
      this.reportProgress(
        onProgress,
        DeploymentState.VALIDATING,
        "Validating files...",
        10
      );

      const validation = await this.validatePrerequisites(files, config);
      if (!validation.valid) {
        return this.failedResult(validation.errors.join("; "), "VALIDATION_ERROR");
      }

      // Step 2: Get or create repository
      this.reportProgress(
        onProgress,
        DeploymentState.UPLOADING,
        "Setting up repository...",
        20
      );

      const owner = config.githubOwner || (await this.getUsername(token));
      if (!owner) {
        return this.failedResult("Could not determine GitHub username", "AUTH_ERROR");
      }

      let repo = await this.getRepo(token, owner, config.projectName);
      if (!repo) {
        repo = await this.createRepo(token, config.projectName);
        if (!repo) {
          return this.failedResult("Failed to create repository", "CREATE_FAILED");
        }
      }

      // Step 3: Create/update gh-pages branch
      this.reportProgress(
        onProgress,
        DeploymentState.UPLOADING,
        "Uploading files...",
        40
      );

      // Add .nojekyll if not present
      const filesToDeploy = [...files];
      if (!files.some((f) => f.path.includes(".nojekyll"))) {
        filesToDeploy.push({ path: ".nojekyll", content: "", lang: "text" });
      }

      const success = await this.pushToGhPages(
        token,
        owner,
        repo.name,
        filesToDeploy,
        onProgress
      );

      if (!success) {
        return this.failedResult("Failed to push files", "PUSH_FAILED");
      }

      // Step 4: Enable GitHub Pages
      this.reportProgress(
        onProgress,
        DeploymentState.DEPLOYING,
        "Enabling GitHub Pages...",
        80
      );

      await this.enablePages(token, owner, repo.name);

      // Step 5: Wait for deployment
      this.reportProgress(
        onProgress,
        DeploymentState.DEPLOYING,
        "Waiting for GitHub Pages to deploy...",
        90
      );

      const pagesUrl = await this.waitForPages(token, owner, repo.name);

      this.reportProgress(
        onProgress,
        DeploymentState.DEPLOYED,
        "Deployment complete!",
        100
      );

      return this.successResult(
        pagesUrl || `https://${owner}.github.io/${repo.name}`,
        repo.name
      );
    } catch (e: any) {
      return this.failedResult(`Deployment failed: ${e.message}`, "UNKNOWN");
    }
  }

  async getDeploymentStatus(
    deploymentId: string,
    config: ProviderConfig
  ): Promise<DeploymentResult> {
    const token = this.getToken(config);
    if (!token) {
      return this.failedResult("Token not configured", "TOKEN_MISSING");
    }

    const owner = config.githubOwner || (await this.getUsername(token));
    if (!owner) {
      return this.failedResult("Could not determine GitHub username", "AUTH_ERROR");
    }

    try {
      const pagesInfo = await this.getPagesInfo(token, owner, deploymentId);
      return this.normalizeResult(pagesInfo);
    } catch (e: any) {
      return this.failedResult(`Status check failed: ${e.message}`, "UNKNOWN");
    }
  }

  normalizeResult(response: unknown): DeploymentResult {
    const data = response as GitHubPagesInfo | null;

    if (!data) {
      return this.failedResult("Pages not configured", "NOT_CONFIGURED");
    }

    switch (data.status) {
      case "built":
        return this.successResult(data.url, "gh-pages");
      case "errored":
        return this.failedResult("GitHub Pages build failed", "BUILD_FAILED");
      case "building":
        return this.progressResult(DeploymentState.BUILDING, "gh-pages");
      default:
        return this.progressResult(DeploymentState.DEPLOYING, "gh-pages");
    }
  }

  /**
   * Get authenticated user's username
   */
  private async getUsername(token: string): Promise<string | null> {
    try {
      const response = await fetch(`${GITHUB_API_BASE}/user`, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.login;
    } catch {
      return null;
    }
  }

  /**
   * Get repository info
   */
  private async getRepo(
    token: string,
    owner: string,
    name: string
  ): Promise<GitHubRepo | null> {
    try {
      const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${name}`, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Create a new repository
   */
  private async createRepo(
    token: string,
    name: string
  ): Promise<GitHubRepo | null> {
    try {
      const response = await fetch(`${GITHUB_API_BASE}/user/repos`, {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({
          name,
          description: "Generated by UI Gen AI",
          private: false,
          auto_init: true,
        }),
      });

      if (!response.ok) {
        console.error("Failed to create repo:", await response.text());
        return null;
      }

      return await response.json();
    } catch (e) {
      console.error("Error creating repo:", e);
      return null;
    }
  }

  /**
   * Push files to gh-pages branch
   */
  private async pushToGhPages(
    token: string,
    owner: string,
    repo: string,
    files: GeneratedFile[],
    onProgress?: (progress: DeploymentProgress) => void
  ): Promise<boolean> {
    try {
      // Get or create gh-pages branch
      let baseSha = await this.getBranchSha(token, owner, repo, "gh-pages");
      
      if (!baseSha) {
        // Get default branch SHA to base gh-pages on
        const defaultBranch = await this.getDefaultBranch(token, owner, repo);
        baseSha = await this.getBranchSha(token, owner, repo, defaultBranch || "main");
        
        if (!baseSha) {
          // Create initial commit
          baseSha = await this.createInitialCommit(token, owner, repo);
        }
      }

      if (!baseSha) {
        return false;
      }

      this.reportProgress(
        onProgress,
        DeploymentState.UPLOADING,
        "Creating file blobs...",
        50
      );

      // Create blobs for all files
      const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
      
      for (const file of files) {
        const blobSha = await this.createBlob(token, owner, repo, file.content);
        if (blobSha) {
          const path = file.path.startsWith("/") ? file.path.slice(1) : file.path;
          treeItems.push({
            path,
            mode: "100644",
            type: "blob",
            sha: blobSha,
          });
        }
      }

      this.reportProgress(
        onProgress,
        DeploymentState.UPLOADING,
        "Creating tree...",
        60
      );

      // Create tree
      const tree = await this.createTree(token, owner, repo, treeItems);
      if (!tree) {
        return false;
      }

      this.reportProgress(
        onProgress,
        DeploymentState.UPLOADING,
        "Creating commit...",
        70
      );

      // Create commit
      const commit = await this.createCommit(
        token,
        owner,
        repo,
        tree.sha,
        baseSha,
        "Deploy from UI Gen AI"
      );
      if (!commit) {
        return false;
      }

      // Update or create gh-pages ref
      const refExists = await this.getBranchSha(token, owner, repo, "gh-pages");
      if (refExists) {
        await this.updateRef(token, owner, repo, "heads/gh-pages", commit.sha);
      } else {
        await this.createRef(token, owner, repo, "refs/heads/gh-pages", commit.sha);
      }

      return true;
    } catch (e) {
      console.error("Error pushing to gh-pages:", e);
      return false;
    }
  }

  private async getBranchSha(
    token: string,
    owner: string,
    repo: string,
    branch: string
  ): Promise<string | null> {
    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/ref/heads/${branch}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.v3+json",
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      const data: GitHubRef = await response.json();
      return data.object.sha;
    } catch {
      return null;
    }
  }

  private async getDefaultBranch(
    token: string,
    owner: string,
    repo: string
  ): Promise<string | null> {
    try {
      const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (!response.ok) {
        return null;
      }

      const data: GitHubRepo = await response.json();
      return data.default_branch;
    } catch {
      return null;
    }
  }

  private async createInitialCommit(
    token: string,
    owner: string,
    repo: string
  ): Promise<string | null> {
    // Create an empty tree and initial commit
    const tree = await this.createTree(token, owner, repo, []);
    if (!tree) return null;

    const commit = await this.createCommit(
      token,
      owner,
      repo,
      tree.sha,
      undefined,
      "Initial commit"
    );

    return commit?.sha || null;
  }

  private async createBlob(
    token: string,
    owner: string,
    repo: string,
    content: string
  ): Promise<string | null> {
    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/blobs`,
        {
          method: "POST",
          headers: {
            Authorization: `token ${token}`,
            "Content-Type": "application/json",
            Accept: "application/vnd.github.v3+json",
          },
          body: JSON.stringify({
            content: Buffer.from(content).toString("base64"),
            encoding: "base64",
          }),
        }
      );

      if (!response.ok) {
        return null;
      }

      const data: GitHubBlob = await response.json();
      return data.sha;
    } catch {
      return null;
    }
  }

  private async createTree(
    token: string,
    owner: string,
    repo: string,
    items: Array<{ path: string; mode: string; type: string; sha: string }>
  ): Promise<GitHubTree | null> {
    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees`,
        {
          method: "POST",
          headers: {
            Authorization: `token ${token}`,
            "Content-Type": "application/json",
            Accept: "application/vnd.github.v3+json",
          },
          body: JSON.stringify({ tree: items }),
        }
      );

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch {
      return null;
    }
  }

  private async createCommit(
    token: string,
    owner: string,
    repo: string,
    treeSha: string,
    parentSha?: string,
    message: string = "Deploy"
  ): Promise<GitHubCommit | null> {
    try {
      const body: any = {
        message,
        tree: treeSha,
      };
      if (parentSha) {
        body.parents = [parentSha];
      }

      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits`,
        {
          method: "POST",
          headers: {
            Authorization: `token ${token}`,
            "Content-Type": "application/json",
            Accept: "application/vnd.github.v3+json",
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch {
      return null;
    }
  }

  private async createRef(
    token: string,
    owner: string,
    repo: string,
    ref: string,
    sha: string
  ): Promise<boolean> {
    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs`,
        {
          method: "POST",
          headers: {
            Authorization: `token ${token}`,
            "Content-Type": "application/json",
            Accept: "application/vnd.github.v3+json",
          },
          body: JSON.stringify({ ref, sha }),
        }
      );

      return response.ok;
    } catch {
      return false;
    }
  }

  private async updateRef(
    token: string,
    owner: string,
    repo: string,
    ref: string,
    sha: string
  ): Promise<boolean> {
    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs/${ref}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `token ${token}`,
            "Content-Type": "application/json",
            Accept: "application/vnd.github.v3+json",
          },
          body: JSON.stringify({ sha, force: true }),
        }
      );

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Enable GitHub Pages on the repository
   */
  private async enablePages(
    token: string,
    owner: string,
    repo: string
  ): Promise<boolean> {
    try {
      // First check if pages is already enabled
      const pagesInfo = await this.getPagesInfo(token, owner, repo);
      if (pagesInfo) {
        return true;
      }

      // Enable pages
      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/pages`,
        {
          method: "POST",
          headers: {
            Authorization: `token ${token}`,
            "Content-Type": "application/json",
            Accept: "application/vnd.github.v3+json",
          },
          body: JSON.stringify({
            source: {
              branch: "gh-pages",
              path: "/",
            },
          }),
        }
      );

      return response.ok || response.status === 409; // 409 means already enabled
    } catch {
      return false;
    }
  }

  /**
   * Get GitHub Pages info
   */
  private async getPagesInfo(
    token: string,
    owner: string,
    repo: string
  ): Promise<GitHubPagesInfo | null> {
    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/pages`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.v3+json",
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Wait for GitHub Pages to be deployed
   */
  private async waitForPages(
    token: string,
    owner: string,
    repo: string,
    maxAttempts: number = 30,
    intervalMs: number = 5000
  ): Promise<string | null> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const pagesInfo = await this.getPagesInfo(token, owner, repo);
      
      if (pagesInfo?.status === "built") {
        return pagesInfo.url;
      }

      if (pagesInfo?.status === "errored") {
        return null;
      }

      await this.sleep(intervalMs);
    }

    // Return expected URL even if status is unknown
    return `https://${owner}.github.io/${repo}`;
  }

  private getToken(config: ProviderConfig): string | undefined {
    return (
      config.token ||
      vscode.workspace.getConfiguration("uigenai").get<string>("githubToken")
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Register the provider
registerProvider(
  DeploymentProvider.GITHUB_PAGES,
  () => new GitHubPagesDeploymentProvider()
);
