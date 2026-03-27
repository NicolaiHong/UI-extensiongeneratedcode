/**
 * Render Deployment Provider
 * 
 * Implements deployment to Render using their API for static sites.
 * Creates a new static site or updates an existing one.
 */

import * as vscode from "vscode";
import JSZip from "jszip";
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

const RENDER_API_BASE = "https://api.render.com/v1";

interface RenderService {
  id: string;
  name: string;
  type: string;
  serviceDetails: {
    url?: string;
  };
}

interface RenderDeploy {
  id: string;
  status: "created" | "build_in_progress" | "update_in_progress" | "live" | "deactivated" | "build_failed" | "update_failed" | "canceled" | "pre_deploy_in_progress" | "pre_deploy_failed";
  finishedAt?: string;
}

export class RenderDeploymentProvider
  extends BaseDeploymentProvider
  implements IDeploymentProvider
{
  readonly provider = DeploymentProvider.RENDER;
  readonly name = "Render";

  async checkStatus(config: ProviderConfig): Promise<ProviderStatusResult> {
    const token = this.getToken(config);

    if (!token) {
      return {
        available: true,
        authenticated: false,
        tokenValid: false,
        error: "Render API key not configured",
      };
    }

    try {
      const response = await fetch(`${RENDER_API_BASE}/owners`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
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
          error: `Invalid API key: ${error}`,
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

    // Check for Render token
    const token = this.getToken(config);
    if (!token) {
      errors.push(
        "Render API key not configured. Set it in Settings > UI Gen AI > Render Token"
      );
    }

    // Check for static site compatibility
    const hasIndexHtml = files.some((f) => f.path.endsWith("index.html"));
    if (!hasIndexHtml) {
      warnings.push(
        "No index.html found. Render static site deployment requires an index.html in dist folder after build."
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
      return this.failedResult("Render API key not configured", "TOKEN_MISSING");
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

      // Step 2: Create ZIP of files
      this.reportProgress(
        onProgress,
        DeploymentState.UPLOADING,
        "Creating deployment package...",
        20
      );

      const zip = new JSZip();
      for (const file of files) {
        const path = file.path.startsWith("/") ? file.path.slice(1) : file.path;
        zip.file(path, file.content);
      }
      const zipContent = await zip.generateAsync({ type: "arraybuffer" });

      // Step 3: Find or create static site
      this.reportProgress(
        onProgress,
        DeploymentState.UPLOADING,
        "Setting up Render service...",
        30
      );

      let serviceId = config.renderServiceId;
      let serviceUrl: string | undefined;

      if (!serviceId) {
        // Create a new static site
        const service = await this.createStaticSite(token, config.projectName);
        if (!service) {
          return this.failedResult("Failed to create Render static site", "CREATE_FAILED");
        }
        serviceId = service.id;
        serviceUrl = service.serviceDetails?.url;
      }

      // Step 4: Deploy to service
      this.reportProgress(
        onProgress,
        DeploymentState.DEPLOYING,
        "Deploying to Render...",
        50
      );

      // For static sites, we use the deploy hook or manual deploy
      // Render's static sites typically need a git repo or manual upload
      // We'll use their deploy endpoint for manual deploys
      const deployResult = await this.triggerDeploy(token, serviceId);
      
      if (!deployResult) {
        return this.failedResult("Failed to trigger deployment", "DEPLOY_FAILED");
      }

      // Step 5: Wait for deployment
      this.reportProgress(
        onProgress,
        DeploymentState.BUILDING,
        "Building on Render...",
        60
      );

      const result = await this.pollDeploymentStatus(
        token,
        serviceId,
        deployResult.id,
        onProgress
      );

      // Add the service URL to the result
      if (result.success && serviceUrl) {
        result.url = serviceUrl;
      }

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

    if (!config.renderServiceId) {
      return this.failedResult("Service ID not configured", "CONFIG_ERROR");
    }

    try {
      const response = await fetch(
        `${RENDER_API_BASE}/services/${config.renderServiceId}/deploys/${deploymentId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        return this.failedResult(
          `Failed to get deployment status: ${response.status}`,
          `HTTP_${response.status}`
        );
      }

      const data = await response.json();
      return this.normalizeResult(data);
    } catch (e: any) {
      return this.failedResult(`Status check failed: ${e.message}`, "UNKNOWN");
    }
  }

  normalizeResult(response: unknown): DeploymentResult {
    const data = response as RenderDeploy;

    switch (data.status) {
      case "live":
        return {
          ...this.successResult("", data.id),
          // URL will be set by the caller with the service URL
        };
      case "build_failed":
      case "update_failed":
      case "pre_deploy_failed":
        return this.failedResult("Build failed on Render", "BUILD_FAILED");
      case "canceled":
        return this.failedResult("Deployment was canceled", "CANCELED");
      case "deactivated":
        return this.failedResult("Service is deactivated", "DEACTIVATED");
      case "created":
        return this.progressResult(DeploymentState.PENDING, data.id);
      case "build_in_progress":
      case "pre_deploy_in_progress":
        return this.progressResult(DeploymentState.BUILDING, data.id);
      case "update_in_progress":
        return this.progressResult(DeploymentState.DEPLOYING, data.id);
      default:
        return this.progressResult(DeploymentState.DEPLOYING, data.id);
    }
  }

  /**
   * Create a new static site on Render
   */
  private async createStaticSite(
    token: string,
    projectName: string
  ): Promise<RenderService | null> {
    try {
      const response = await fetch(`${RENDER_API_BASE}/services`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          type: "static_site",
          name: projectName,
          autoDeploy: "no",
          serviceDetails: {
            buildCommand: "npm run build",
            publishPath: "dist",
          },
        }),
      });

      if (!response.ok) {
        console.error("Failed to create static site:", await response.text());
        return null;
      }

      return await response.json();
    } catch (e) {
      console.error("Error creating static site:", e);
      return null;
    }
  }

  /**
   * Trigger a manual deploy
   */
  private async triggerDeploy(
    token: string,
    serviceId: string
  ): Promise<RenderDeploy | null> {
    try {
      const response = await fetch(
        `${RENDER_API_BASE}/services/${serviceId}/deploys`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        console.error("Failed to trigger deploy:", await response.text());
        return null;
      }

      return await response.json();
    } catch (e) {
      console.error("Error triggering deploy:", e);
      return null;
    }
  }

  /**
   * Poll deployment status until completion
   */
  private async pollDeploymentStatus(
    token: string,
    serviceId: string,
    deployId: string,
    onProgress?: (progress: DeploymentProgress) => void,
    maxAttempts: number = 60,
    intervalMs: number = 5000
  ): Promise<DeploymentResult> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(
          `${RENDER_API_BASE}/services/${serviceId}/deploys/${deployId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
          }
        );

        if (!response.ok) {
          await this.sleep(intervalMs);
          continue;
        }

        const data: RenderDeploy = await response.json();
        const progress = Math.min(60 + (attempt / maxAttempts) * 35, 95);

        switch (data.status) {
          case "live":
            this.reportProgress(
              onProgress,
              DeploymentState.DEPLOYED,
              "Deployment complete!",
              100
            );
            // Get the service URL
            const service = await this.getService(token, serviceId);
            return this.successResult(
              service?.serviceDetails?.url || "",
              deployId
            );

          case "build_failed":
          case "update_failed":
          case "pre_deploy_failed":
            return this.failedResult("Build failed", "BUILD_FAILED");

          case "canceled":
          case "deactivated":
            return this.failedResult("Deployment canceled", "CANCELED");

          case "build_in_progress":
          case "pre_deploy_in_progress":
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

  /**
   * Get service details
   */
  private async getService(
    token: string,
    serviceId: string
  ): Promise<RenderService | null> {
    try {
      const response = await fetch(
        `${RENDER_API_BASE}/services/${serviceId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
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

  private getToken(config: ProviderConfig): string | undefined {
    return (
      config.token ||
      vscode.workspace.getConfiguration("uigenai").get<string>("renderToken")
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Register the provider
registerProvider(DeploymentProvider.RENDER, () => new RenderDeploymentProvider());
