/**
 * Vercel Deployment Provider
 * 
 * Implements deployment to Vercel using their v13 Deployments API.
 * Supports direct file uploads without requiring a git repository.
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

const VERCEL_API_BASE = "https://api.vercel.com";

interface VercelDeploymentResponse {
  id: string;
  url: string;
  name: string;
  readyState: "QUEUED" | "BUILDING" | "READY" | "ERROR" | "CANCELED";
  error?: {
    code: string;
    message: string;
  };
}

interface VercelFile {
  file: string;
  data: string;
  encoding: "base64";
}

export class VercelDeploymentProvider
  extends BaseDeploymentProvider
  implements IDeploymentProvider
{
  readonly provider = DeploymentProvider.VERCEL;
  readonly name = "Vercel";

  async checkStatus(config: ProviderConfig): Promise<ProviderStatusResult> {
    const token = this.getToken(config);

    if (!token) {
      return {
        available: true,
        authenticated: false,
        tokenValid: false,
        error: "Vercel token not configured",
      };
    }

    try {
      const response = await fetch(`${VERCEL_API_BASE}/v2/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
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

    // Check for Vercel token
    const token = this.getToken(config);
    if (!token) {
      errors.push(
        "Vercel token not configured. Set it in Settings > UI Gen AI > Vercel Token"
      );
    }

    // Vercel-specific checks
    const hasViteConfig = files.some(
      (f) => f.path.includes("vite.config") || f.path.includes("next.config")
    );
    if (!hasViteConfig) {
      warnings.push(
        "No build config (vite.config/next.config) found. Using default Vite settings."
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
      return this.failedResult(
        "Vercel token not configured",
        "TOKEN_MISSING"
      );
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

      // Step 2: Prepare files
      this.reportProgress(
        onProgress,
        DeploymentState.UPLOADING,
        "Preparing files for upload...",
        20
      );

      const vercelFiles: VercelFile[] = files.map((f) => ({
        file: f.path.startsWith("/") ? f.path.slice(1) : f.path,
        data: Buffer.from(f.content).toString("base64"),
        encoding: "base64" as const,
      }));

      // Step 3: Create deployment
      this.reportProgress(
        onProgress,
        DeploymentState.UPLOADING,
        "Uploading to Vercel...",
        40
      );

      const deploymentPayload = {
        name: config.projectName || "ui-gen-app",
        files: vercelFiles,
        projectSettings: {
          framework: "vite",
          buildCommand: "npm run build",
          outputDirectory: "dist",
          installCommand: "npm install",
        },
        target: "production",
      };

      // Add team ID if specified
      const url = config.teamId
        ? `${VERCEL_API_BASE}/v13/deployments?teamId=${config.teamId}`
        : `${VERCEL_API_BASE}/v13/deployments`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(deploymentPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Vercel API error: ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        return this.failedResult(errorMessage, `HTTP_${response.status}`);
      }

      const data: VercelDeploymentResponse = await response.json();

      // Step 4: Wait for build
      this.reportProgress(
        onProgress,
        DeploymentState.BUILDING,
        "Building on Vercel...",
        60
      );

      // Poll for deployment status
      const result = await this.pollDeploymentStatus(
        data.id,
        token,
        config.teamId,
        onProgress
      );

      return result;
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

    try {
      const url = config.teamId
        ? `${VERCEL_API_BASE}/v13/deployments/${deploymentId}?teamId=${config.teamId}`
        : `${VERCEL_API_BASE}/v13/deployments/${deploymentId}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        return this.failedResult(
          `Failed to get deployment status: ${response.status}`,
          `HTTP_${response.status}`
        );
      }

      const data: VercelDeploymentResponse = await response.json();
      return this.normalizeResult(data);
    } catch (e: any) {
      return this.failedResult(`Status check failed: ${e.message}`, "UNKNOWN");
    }
  }

  normalizeResult(response: unknown): DeploymentResult {
    const data = response as VercelDeploymentResponse;

    switch (data.readyState) {
      case "READY":
        return this.successResult(`https://${data.url}`, data.id);
      case "ERROR":
      case "CANCELED":
        return this.failedResult(
          data.error?.message || "Deployment failed",
          data.error?.code || "VERCEL_ERROR"
        );
      case "QUEUED":
        return this.progressResult(DeploymentState.PENDING, data.id);
      case "BUILDING":
        return this.progressResult(DeploymentState.BUILDING, data.id);
      default:
        return this.progressResult(DeploymentState.DEPLOYING, data.id);
    }
  }

  /**
   * Poll deployment status until completion
   */
  private async pollDeploymentStatus(
    deploymentId: string,
    token: string,
    teamId?: string,
    onProgress?: (progress: DeploymentProgress) => void,
    maxAttempts: number = 60,
    intervalMs: number = 3000
  ): Promise<DeploymentResult> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const url = teamId
        ? `${VERCEL_API_BASE}/v13/deployments/${deploymentId}?teamId=${teamId}`
        : `${VERCEL_API_BASE}/v13/deployments/${deploymentId}`;

      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          await this.sleep(intervalMs);
          continue;
        }

        const data: VercelDeploymentResponse = await response.json();
        const progress = Math.min(60 + (attempt / maxAttempts) * 35, 95);

        switch (data.readyState) {
          case "READY":
            this.reportProgress(
              onProgress,
              DeploymentState.DEPLOYED,
              "Deployment complete!",
              100
            );
            return this.successResult(`https://${data.url}`, data.id);

          case "ERROR":
          case "CANCELED":
            return this.failedResult(
              data.error?.message || "Build failed",
              data.error?.code
            );

          case "BUILDING":
            this.reportProgress(
              onProgress,
              DeploymentState.BUILDING,
              "Building...",
              progress
            );
            break;

          default:
            this.reportProgress(
              onProgress,
              DeploymentState.DEPLOYING,
              "Deploying...",
              progress
            );
        }
      } catch {
        // Continue polling on network errors
      }

      await this.sleep(intervalMs);
    }

    return this.failedResult("Deployment timed out", "TIMEOUT");
  }

  private getToken(config: ProviderConfig): string | undefined {
    return (
      config.token ||
      vscode.workspace.getConfiguration("uigenai").get<string>("vercelToken")
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Register the provider
registerProvider(DeploymentProvider.VERCEL, () => new VercelDeploymentProvider());
