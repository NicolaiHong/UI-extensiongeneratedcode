/**
 * Deployment Commands
 *
 * Per implementation_plan_api_generation_deloyment.md:
 * - Deploy to Vercel, Render, or GitHub Pages
 * - Check readiness before deployment
 * - Show deployment status and results
 */

import * as vscode from "vscode";
import {
  deploymentsApi,
  DeploymentProvider,
  DeploymentEnvironment,
} from "../api/deployments.api";
import { apisApi } from "../api/apis.api";
import { sessionsApi } from "../api/sessions.api";
import { extractApiError } from "../utils/errors";

const PROVIDERS: { label: string; value: DeploymentProvider }[] = [
  { label: "Vercel", value: "VERCEL" },
  { label: "Render", value: "RENDER" },
  { label: "GitHub Pages", value: "GITHUB_PAGES" },
];

const ENVIRONMENTS: { label: string; value: DeploymentEnvironment }[] = [
  { label: "Development", value: "DEVELOPMENT" },
  { label: "Staging", value: "STAGING" },
  { label: "Production", value: "PRODUCTION" },
];

/**
 * Deploy an API to a provider.
 * Full workflow: select API -> check readiness -> select provider -> deploy
 */
export async function deployToProviderCmd() {
  // 1. Select API
  let apis;
  try {
    apis = await apisApi.list();
  } catch (e: unknown) {
    vscode.window.showErrorMessage(
      `Failed to load APIs: ${extractApiError(e)}`,
    );
    return;
  }

  if (!apis.length) {
    vscode.window.showWarningMessage("No APIs found. Create an API first.");
    return;
  }

  const apiPick = await vscode.window.showQuickPick(
    apis.map((a) => ({ label: a.name, description: a.status, value: a.id })),
    { title: "Select API to deploy" },
  );
  if (!apiPick) return;

  // 2. Check readiness
  let readiness;
  try {
    readiness = await deploymentsApi.checkReadiness(apiPick.value);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(
      `Failed to check readiness: ${extractApiError(e)}`,
    );
    return;
  }

  if (!readiness.deployable) {
    vscode.window.showWarningMessage(
      `Cannot deploy: ${readiness.message}\n${readiness.missing_requirements.join(", ")}`,
    );
    return;
  }

  // Handle already deployed case
  if (readiness.current_status === "DEPLOYED") {
    const redeploy = await vscode.window.showQuickPick(
      [
        { label: "Yes, redeploy", value: true },
        { label: "No, cancel", value: false },
      ],
      { title: "API is already deployed. Redeploy?" },
    );
    if (!redeploy?.value) return;
  }

  // 3. Get session ID (either from readiness check or ask user to select)
  let sessionId = readiness.session_id;
  if (!sessionId) {
    // Need to find a session - this shouldn't happen if readiness.deployable is true
    vscode.window.showErrorMessage("No session found for deployment.");
    return;
  }

  // 4. Select provider
  const providerPick = await vscode.window.showQuickPick(PROVIDERS, {
    title: "Select deployment provider",
  });
  if (!providerPick) return;

  // 5. Select environment
  const envPick = await vscode.window.showQuickPick(ENVIRONMENTS, {
    title: "Select environment",
  });
  if (!envPick) return;

  // 6. Deploy
  try {
    vscode.window.showInformationMessage(
      `Starting deployment to ${providerPick.label}...`,
    );

    const result = await deploymentsApi.deploy(apiPick.value, {
      session_id: sessionId,
      provider: providerPick.value,
      environment: envPick.value,
    });

    vscode.window.showInformationMessage(
      `${result.message}${result.deployment.deploy_url ? ` URL: ${result.deployment.deploy_url}` : ""}`,
    );

    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Deployment failed: ${extractApiError(e)}`);
  }
}

/**
 * Check deployment readiness for an API.
 */
export async function checkReadinessCmd(apiId?: string) {
  // Select API if not provided
  if (!apiId) {
    let apis;
    try {
      apis = await apisApi.list();
    } catch (e: unknown) {
      vscode.window.showErrorMessage(
        `Failed to load APIs: ${extractApiError(e)}`,
      );
      return;
    }

    if (!apis.length) {
      vscode.window.showWarningMessage("No APIs found.");
      return;
    }

    const apiPick = await vscode.window.showQuickPick(
      apis.map((a) => ({ label: a.name, value: a.id })),
      { title: "Select API to check" },
    );
    if (!apiPick) return;
    apiId = apiPick.value;
  }

  try {
    const readiness = await deploymentsApi.checkReadiness(apiId);

    const statusIcon = readiness.deployable ? "✅" : "❌";
    let message = `${statusIcon} ${readiness.message}`;

    if (readiness.current_status) {
      message += `\nCurrent status: ${readiness.current_status}`;
    }

    if (readiness.missing_requirements.length > 0) {
      message += `\nMissing: ${readiness.missing_requirements.join(", ")}`;
    }

    vscode.window.showInformationMessage(message);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Failed: ${extractApiError(e)}`);
  }
}

/**
 * Start deployment on an existing deployment record.
 */
export async function startDeploymentCmd(apiId: string, deploymentId: string) {
  const providerPick = await vscode.window.showQuickPick(PROVIDERS, {
    title: "Select deployment provider",
  });
  if (!providerPick) return;

  const envPick = await vscode.window.showQuickPick(ENVIRONMENTS, {
    title: "Select environment",
  });
  if (!envPick) return;

  try {
    const result = await deploymentsApi.startDeployment(apiId, deploymentId, {
      provider: providerPick.value,
      environment: envPick.value,
    });

    vscode.window.showInformationMessage(result.message);
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Failed: ${extractApiError(e)}`);
  }
}

// ========== LEGACY COMMANDS (backward compatible) ==========

export async function createDeploymentCmd() {
  let apis;
  try {
    apis = await apisApi.list();
  } catch (e: unknown) {
    vscode.window.showErrorMessage(
      `Failed to load APIs: ${extractApiError(e)}`,
    );
    return;
  }
  if (!apis.length) {
    vscode.window.showWarningMessage("No APIs found. Create an API first.");
    return;
  }

  const apiPick = await vscode.window.showQuickPick(
    apis.map((a) => ({ label: a.name, value: a.id })),
    { title: "Select API for deployment" },
  );
  if (!apiPick) {
    return;
  }

  const env = await vscode.window.showQuickPick(ENVIRONMENTS, {
    title: "Environment",
  });
  if (!env) {
    return;
  }

  const providerPick = await vscode.window.showQuickPick(
    [{ label: "None (set later)", value: undefined }, ...PROVIDERS],
    { title: "Provider (optional)" },
  );

  try {
    const d = await deploymentsApi.create(apiPick.value, {
      environment: env.value,
      provider: providerPick?.value,
    });
    vscode.window.showInformationMessage(
      `Deployment created! Status: ${d.status}`,
    );
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Failed: ${extractApiError(e)}`);
  }
}

export async function updateDeploymentStatusCmd(
  apiId: string,
  deploymentId: string,
) {
  const status = await vscode.window.showQuickPick(
    [
      { label: "PENDING", value: "PENDING" },
      { label: "READY_TO_DEPLOY", value: "READY_TO_DEPLOY" },
      { label: "DEPLOYING", value: "DEPLOYING" },
      { label: "DEPLOYED", value: "DEPLOYED" },
      { label: "DEPLOY_FAILED", value: "DEPLOY_FAILED" },
    ],
    { title: "Update Status" },
  );
  if (!status) {
    return;
  }

  try {
    await deploymentsApi.update(apiId, deploymentId, {
      status: status.value as any,
    });
    vscode.window.showInformationMessage(
      `Deployment status updated to ${status.value}`,
    );
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Failed: ${extractApiError(e)}`);
  }
}
