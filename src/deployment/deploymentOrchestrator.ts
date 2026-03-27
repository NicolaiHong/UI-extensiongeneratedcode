/**
 * Deployment Orchestrator
 *
 * Coordinates the deployment workflow:
 * - Validates prerequisites
 * - Manages state transitions
 * - Routes to appropriate provider
 * - Tracks deployment progress and results
 * - Prevents duplicate deployments (idempotent)
 */

import * as vscode from "vscode";
import {
  DeploymentProvider,
  DeploymentResult,
  DeploymentState,
  DeploymentProgress,
  DeploymentJob,
  GeneratedFile,
  ProviderConfig,
  PROVIDER_INFO,
  canDeploy,
  isDeploymentInProgress,
  isDeployed,
} from "./types";
import {
  getProvider,
  hasProvider,
  IDeploymentProvider,
} from "./providers/base";
import { apisApi, WorkflowState } from "../api/apis.api";
import { deploymentsApi } from "../api/deployments.api";
import { generatedCodesApi } from "../api/generatedCodes.api";
import { parseSessionOutputToFiles } from "../utils/previewPanel";

// Import providers to register them
import "./providers";

/**
 * Active deployment jobs (in-memory tracking by apiId)
 */
const activeJobs = new Map<string, DeploymentJob>();

/**
 * In-flight deployment requests (to prevent duplicate concurrent calls)
 * Tracks startedAt to clean up stale entries that never resolved.
 */
const inFlightDeployments = new Map<
  string,
  { promise: Promise<DeploymentResult>; startedAt: number }
>();

const IN_FLIGHT_STALE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Progress callbacks for active deployments
 */
const progressCallbacks = new Map<
  string,
  (progress: DeploymentProgress) => void
>();

/**
 * Start a new deployment (idempotent)
 * 
 * If a deployment is already in progress for this API, returns immediately
 * without starting a duplicate deployment.
 */
export async function startDeployment(
  apiId: string,
  provider: DeploymentProvider,
  config: Partial<ProviderConfig>,
  onProgress?: (progress: DeploymentProgress) => void,
): Promise<DeploymentResult> {
  // Clean up stale in-flight entries
  for (const [key, entry] of inFlightDeployments.entries()) {
    if (Date.now() - entry.startedAt > IN_FLIGHT_STALE_TTL_MS) {
      console.log(`[deployment] Cleaning stale in-flight entry for apiId=${key}`);
      inFlightDeployments.delete(key);
    }
  }

  // Check for in-flight deployment (same request in progress)
  const inFlight = inFlightDeployments.get(apiId);
  if (inFlight) {
    console.log(`[deployment] Returning in-flight deployment for apiId=${apiId}`);
    return inFlight.promise;
  }

  // Validate provider is registered
  if (!hasProvider(provider)) {
    return {
      success: false,
      provider,
      state: DeploymentState.FAILED,
      error: `Provider ${provider} is not available`,
      errorCode: "PROVIDER_NOT_FOUND",
    };
  }

  // Create and track the deployment promise
  const deploymentPromise = executeStartDeployment(apiId, provider, config, onProgress);
  inFlightDeployments.set(apiId, { promise: deploymentPromise, startedAt: Date.now() });

  try {
    const result = await deploymentPromise;
    return result;
  } finally {
    inFlightDeployments.delete(apiId);
  }
}

/**
 * Internal deployment execution
 */
async function executeStartDeployment(
  apiId: string,
  provider: DeploymentProvider,
  config: Partial<ProviderConfig>,
  onProgress?: (progress: DeploymentProgress) => void,
): Promise<DeploymentResult> {
  try {
    // Step 1: Get API and validate state
    const api = await apisApi.getById(apiId);
    
    // Handle idempotent cases
    if (isDeploymentInProgress(api.workflow_state)) {
      console.log(`[deployment] Deployment already in progress for apiId=${apiId}, state=${api.workflow_state}`);
      return {
        success: true,
        provider,
        state: DeploymentState.DEPLOYING,
        error: undefined,
        errorCode: "DEPLOYMENT_IN_PROGRESS",
      };
    }

    if (isDeployed(api.workflow_state)) {
      console.log(`[deployment] API already deployed, apiId=${apiId}`);
      // For already deployed APIs, we allow redeployment
      // but we should inform the caller
    }

    if (!canDeploy(api.workflow_state)) {
      return {
        success: false,
        provider,
        state: DeploymentState.FAILED,
        error: `API is not ready for deployment. Current state: ${api.workflow_state}`,
        errorCode: "INVALID_STATE",
      };
    }

    // Step 2: Get generated files
    const files = await getGeneratedFiles(apiId);
    if (!files || files.length === 0) {
      return {
        success: false,
        provider,
        state: DeploymentState.FAILED,
        error: "No generated files found. Run full source generation first.",
        errorCode: "NO_FILES",
      };
    }

    // Step 3: Build provider config
    const fullConfig: ProviderConfig = {
      provider,
      projectName:
        config.projectName || api.name.toLowerCase().replace(/\s+/g, "-"),
      token: config.token,
      teamId: config.teamId,
      vercelProjectId: config.vercelProjectId,
      renderServiceId: config.renderServiceId,
      githubRepo: config.githubRepo,
      githubBranch: config.githubBranch || "gh-pages",
      githubOwner: config.githubOwner,
    };

    // Step 4: Update API state to DEPLOYING
    await apisApi.updateWorkflowState(apiId, "DEPLOYING");

    // Step 5: Create deployment record
    const deployment = await deploymentsApi.create(apiId, {
      provider: provider,
      status: "IN_PROGRESS",
      environment: "PRODUCTION",
      metadata_json: {
        provider,
        startedAt: new Date().toISOString(),
      },
    });

    // Step 6: Create job tracking
    const job: DeploymentJob = {
      id: deployment.id,
      apiId,
      provider,
      state: DeploymentState.PENDING,
      config: fullConfig,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    activeJobs.set(deployment.id, job);

    if (onProgress) {
      progressCallbacks.set(deployment.id, onProgress);
    }

    // Step 7: Execute deployment
    const deploymentProvider = getProvider(provider);
    const result = await executeDeployment(
      deploymentProvider,
      files,
      fullConfig,
      deployment.id,
      apiId,
    );

    // Step 8: Update final state
    await finalizeDeployment(apiId, deployment.id, result);

    // Clean up
    activeJobs.delete(deployment.id);
    progressCallbacks.delete(deployment.id);

    return result;
  } catch (e: any) {
    console.error("[deployment] Error:", e);

    // Try to revert state on error
    try {
      await apisApi.updateWorkflowState(apiId, "READY_TO_DEPLOY");
    } catch {
      // Ignore state revert errors
    }

    return {
      success: false,
      provider,
      state: DeploymentState.FAILED,
      error: e.message || "Deployment failed",
      errorCode: "UNKNOWN",
    };
  }
}

/**
 * Execute the actual deployment
 */
async function executeDeployment(
  provider: IDeploymentProvider,
  files: GeneratedFile[],
  config: ProviderConfig,
  deploymentId: string,
  apiId: string,
): Promise<DeploymentResult> {
  const onProgress = progressCallbacks.get(deploymentId);

  try {
    // Validate prerequisites first
    const validation = await provider.validatePrerequisites(files, config);

    if (!validation.valid) {
      return {
        success: false,
        provider: config.provider,
        state: DeploymentState.FAILED,
        error: validation.errors.join("; "),
        errorCode: "VALIDATION_FAILED",
      };
    }

    // Show warnings if any
    if (validation.warnings.length > 0 && onProgress) {
      onProgress({
        state: DeploymentState.VALIDATING,
        message: `Warnings: ${validation.warnings.join("; ")}`,
      });
    }

    // Execute deployment
    const result = await provider.createDeployment(files, config, onProgress);

    return result;
  } catch (e: any) {
    return {
      success: false,
      provider: config.provider,
      state: DeploymentState.FAILED,
      error: e.message || "Deployment execution failed",
      errorCode: "EXECUTION_ERROR",
    };
  }
}

/**
 * Finalize deployment - update API state and deployment record
 */
async function finalizeDeployment(
  apiId: string,
  deploymentId: string,
  result: DeploymentResult,
): Promise<void> {
  const newState: WorkflowState = result.success ? "DEPLOYED" : "FAILED";
  const deploymentStatus = result.success ? "DEPLOYED" : "FAILED";

  try {
    // Update API workflow state
    await apisApi.updateWorkflowState(apiId, newState);

    // Update deployment record
    await deploymentsApi.update(apiId, deploymentId, {
      status: deploymentStatus as any,
      metadata_json: {
        provider: result.provider,
        url: result.url,
        error: result.error,
        errorCode: result.errorCode,
        completedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.error("[deployment] Failed to finalize deployment:", e);
  }
}

/**
 * Get generated files for an API
 *
 * Tries two sources in order:
 * 1. Latest FULL_SOURCE session's output_summary_md (current source of truth)
 * 2. generated_codes table (legacy storage)
 *
 * NOTE: listSessions may not include output_summary_md in the response,
 * so we must fetch the full session details using getSession().
 */
async function getGeneratedFiles(apiId: string): Promise<GeneratedFile[]> {
  // Strategy 1: Prefer latest FULL_SOURCE session output (current source of truth)
  try {
    const sessions = await apisApi.listSessions(apiId, "FULL_SOURCE");

    // Find the most recent successful session (listSessions may not include output_summary_md)
    const successfulSessions = sessions
      .filter((s: any) => s.status === "SUCCEEDED")
      .sort(
        (a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

    if (successfulSessions.length > 0) {
      const latestSessionSummary = successfulSessions[0];
      console.log(
        "[deployment] Found FULL_SOURCE session:",
        latestSessionSummary.id,
      );

      // Fetch full session details to get output_summary_md
      const fullSession = await apisApi.getSession(
        apiId,
        latestSessionSummary.id,
      );

      if (fullSession.output_summary_md) {
        console.log("[deployment] Fetched full session with output_summary_md");
        const files = parseSessionOutputToFiles(fullSession.output_summary_md);
        if (files.length > 0) {
          console.log(
            "[deployment] Parsed files from session output:",
            files.length,
          );
          return files.map((f) => ({
            path: f.path,
            content: f.content,
            lang: f.lang || undefined,
          }));
        } else {
          console.log(
            "[deployment] parseSessionOutputToFiles returned 0 files",
          );
        }
      } else {
        console.log("[deployment] Session has no output_summary_md");
      }
    } else {
      console.log("[deployment] No successful FULL_SOURCE sessions found");
    }
  } catch (e) {
    console.log("[deployment] FULL_SOURCE lookup failed:", e);
  }

  // Strategy 2: Fallback to generated_codes table (legacy storage)
  try {
    const codes = await generatedCodesApi.list(apiId);
    if (codes && codes.length > 0) {
      console.log(
        "[deployment] Found files in generated_codes table:",
        codes.length,
      );
      return codes.map((code) => ({
        path: code.file_path,
        content: code.content,
        lang: code.language || undefined,
      }));
    }
  } catch (e) {
    console.error("[deployment] generated_codes fallback failed:", e);
  }

  console.error("[deployment] No generated files found from any source");
  return [];
}

/**
 * Check deployment status
 */
export async function checkDeploymentStatus(
  apiId: string,
  deploymentId: string,
  provider: DeploymentProvider,
): Promise<DeploymentResult> {
  if (!hasProvider(provider)) {
    return {
      success: false,
      provider,
      state: DeploymentState.FAILED,
      error: `Provider ${provider} is not available`,
      errorCode: "PROVIDER_NOT_FOUND",
    };
  }

  try {
    const config = await buildConfigFromDeployment(apiId, deploymentId);
    const deploymentProvider = getProvider(provider);
    return await deploymentProvider.getDeploymentStatus(deploymentId, config);
  } catch (e: any) {
    return {
      success: false,
      provider,
      state: DeploymentState.FAILED,
      error: e.message || "Status check failed",
      errorCode: "STATUS_CHECK_ERROR",
    };
  }
}

/**
 * Build config from existing deployment
 */
async function buildConfigFromDeployment(
  apiId: string,
  deploymentId: string,
): Promise<ProviderConfig> {
  const deployment = await deploymentsApi.getById(apiId, deploymentId);
  const api = await apisApi.getById(apiId);

  const metadata = deployment.metadata_json || {};

  return {
    provider: deployment.provider as DeploymentProvider,
    projectName: api.name.toLowerCase().replace(/\s+/g, "-"),
    renderServiceId: metadata.renderServiceId,
    githubOwner: metadata.githubOwner,
    githubRepo: metadata.githubRepo,
  };
}

/**
 * Get available providers with their status
 */
export async function getAvailableProviders(): Promise<
  Array<{
    provider: DeploymentProvider;
    info: (typeof PROVIDER_INFO)[DeploymentProvider];
    configured: boolean;
  }>
> {
  const config = vscode.workspace.getConfiguration("uigenai");

  return Object.values(DeploymentProvider).map((provider) => {
    const info = PROVIDER_INFO[provider];
    let configured = false;

    switch (provider) {
      case DeploymentProvider.VERCEL:
        configured = !!config.get<string>("vercelToken");
        break;
      case DeploymentProvider.RENDER:
        configured = !!config.get<string>("renderToken");
        break;
      case DeploymentProvider.GITHUB_PAGES:
        configured = !!config.get<string>("githubToken");
        break;
    }

    return { provider, info, configured };
  });
}

/**
 * Get active deployment job
 */
export function getActiveJob(deploymentId: string): DeploymentJob | undefined {
  return activeJobs.get(deploymentId);
}

/**
 * Check if a deployment is currently running for an API
 */
export function hasActiveDeployment(apiId: string): boolean {
  for (const job of activeJobs.values()) {
    if (job.apiId === apiId) {
      return true;
    }
  }
  return false;
}

/**
 * Show deployment progress in VS Code
 */
export async function deployWithProgress(
  apiId: string,
  provider: DeploymentProvider,
  config: Partial<ProviderConfig>,
): Promise<DeploymentResult> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Deploying to ${PROVIDER_INFO[provider].name}...`,
      cancellable: false,
    },
    async (progress) => {
      const result = await startDeployment(apiId, provider, config, (p) => {
        progress.report({
          message: p.message,
          increment: p.percentage ? p.percentage / 100 : undefined,
        });
      });

      return result;
    },
  );
}

/**
 * Quick deploy with UI prompts
 */
export async function quickDeploy(
  apiId: string,
): Promise<DeploymentResult | undefined> {
  // Get available providers
  const providers = await getAvailableProviders();
  const configuredProviders = providers.filter((p) => p.configured);

  if (configuredProviders.length === 0) {
    const setup = await vscode.window.showWarningMessage(
      "No deployment providers configured. Set up API tokens in Settings.",
      "Open Settings",
    );
    if (setup === "Open Settings") {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "uigenai",
      );
    }
    return undefined;
  }

  // Pick provider
  const picks = configuredProviders.map((p) => ({
    label: `${p.info.icon} ${p.info.name}`,
    description: p.info.description,
    provider: p.provider,
  }));

  const selection = await vscode.window.showQuickPick(picks, {
    title: "Select Deployment Provider",
    placeHolder: "Where do you want to deploy?",
  });

  if (!selection) {
    return undefined;
  }

  // Get project name
  const api = await apisApi.getById(apiId);
  const defaultName = api.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  const projectName = await vscode.window.showInputBox({
    title: "Project Name",
    value: defaultName,
    placeHolder: "my-project",
    validateInput: (value) => {
      if (!value) return "Project name is required";
      if (!/^[a-z0-9-]+$/i.test(value)) {
        return "Use only letters, numbers, and hyphens";
      }
      return undefined;
    },
  });

  if (!projectName) {
    return undefined;
  }

  // Deploy
  return deployWithProgress(apiId, selection.provider, { projectName });
}
