import * as vscode from "vscode";
import { deploymentsApi } from "../api/deployments.api";
import { apisApi } from "../api/apis.api";
import { extractApiError } from "../utils/errors";
import {
  DeploymentProvider,
  PROVIDER_INFO,
} from "../deployment/types";
import {
  quickDeploy,
  deployWithProgress,
  getAvailableProviders,
} from "../deployment/deploymentOrchestrator";
import {
  hasToken,
  promptTokenSetup,
  testProviderConnection,
} from "../deployment/tokenValidator";

/**
 * Quick deploy command - prompts for provider and deploys
 */
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

  // Filter to APIs that can be deployed
  const deployableApis = apis.filter((a) => apisApi.canDeploy(a));
  
  if (!deployableApis.length) {
    vscode.window.showWarningMessage(
      "No APIs are ready for deployment. Run full source generation first and mark as ready.",
    );
    return;
  }

  const apiPick = await vscode.window.showQuickPick(
    deployableApis.map((a) => ({
      label: a.name,
      description: a.workflow_state || "",
      value: a.id,
    })),
    { title: "Select API to deploy" },
  );
  if (!apiPick) {
    return;
  }

  // Use quick deploy flow
  const result = await quickDeploy(apiPick.value);
  
  if (result) {
    if (result.success) {
      const action = await vscode.window.showInformationMessage(
        `Deployed successfully!`,
        "Open URL",
        "Done",
      );
      if (action === "Open URL" && result.url) {
        vscode.env.openExternal(vscode.Uri.parse(result.url));
      }
    } else {
      vscode.window.showErrorMessage(`Deployment failed: ${result.error}`);
    }
    vscode.commands.executeCommand("uigenai.refreshSidebar");
  }
}

/**
 * Deploy to Vercel command
 */
export async function deployToVercelCmd(apiId?: string) {
  await deployToProvider(DeploymentProvider.VERCEL, apiId);
}

/**
 * Deploy to Render command
 */
export async function deployToRenderCmd(apiId?: string) {
  await deployToProvider(DeploymentProvider.RENDER, apiId);
}

/**
 * Deploy to GitHub Pages command
 */
export async function deployToGitHubPagesCmd(apiId?: string) {
  await deployToProvider(DeploymentProvider.GITHUB_PAGES, apiId);
}

/**
 * Common deploy to provider logic
 */
async function deployToProvider(
  provider: DeploymentProvider,
  apiId?: string,
) {
  const info = PROVIDER_INFO[provider];

  // Check token
  if (!hasToken(provider)) {
    const setup = await promptTokenSetup(provider);
    if (!setup) {
      return;
    }
  }

  // Get API to deploy
  let targetApiId = apiId;
  
  if (!targetApiId) {
    const apis = await apisApi.list();
    const deployableApis = apis.filter((a) => apisApi.canDeploy(a));
    
    if (!deployableApis.length) {
      vscode.window.showWarningMessage(
        "No APIs are ready for deployment.",
      );
      return;
    }

    const pick = await vscode.window.showQuickPick(
      deployableApis.map((a) => ({
        label: a.name,
        description: a.workflow_state || "",
        value: a.id,
      })),
      { title: `Select API to deploy to ${info.name}` },
    );

    if (!pick) {
      return;
    }
    targetApiId = pick.value;
  }

  // Get API name for project name default
  const api = await apisApi.getById(targetApiId);
  const defaultName = api.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  const projectName = await vscode.window.showInputBox({
    title: "Project Name",
    value: defaultName,
    placeHolder: "my-project",
  });

  if (!projectName) {
    return;
  }

  // Re-check API state just before deploying (guard against stale state)
  const freshApi = await apisApi.getById(targetApiId);
  if (apisApi.isDeploymentInProgress(freshApi)) {
    vscode.window.showInformationMessage(
      `Deployment already in progress (state: ${freshApi.workflow_state}).`,
    );
    vscode.commands.executeCommand("uigenai.refreshSidebar");
    return;
  }
  if (!apisApi.canDeploy(freshApi)) {
    vscode.window.showWarningMessage(
      `Cannot deploy: API is in state "${freshApi.workflow_state}". Generate source code first.`,
    );
    return;
  }

  // Deploy
  const result = await deployWithProgress(targetApiId, provider, {
    projectName,
  });

  if (result.success) {
    const action = await vscode.window.showInformationMessage(
      `Deployed to ${info.name}!`,
      "Open URL",
      "Done",
    );
    if (action === "Open URL" && result.url) {
      vscode.env.openExternal(vscode.Uri.parse(result.url));
    }
  } else {
    vscode.window.showErrorMessage(`Deployment failed: ${result.error}`);
  }

  vscode.commands.executeCommand("uigenai.refreshSidebar");
}

/**
 * Test provider connection command
 */
export async function testProviderConnectionCmd() {
  const providers = await getAvailableProviders();
  
  const picks = providers.map((p) => ({
    label: `${p.info.icon} ${p.info.name}`,
    description: p.configured ? "Configured" : "Not configured",
    provider: p.provider,
  }));

  const selection = await vscode.window.showQuickPick(picks, {
    title: "Select Provider to Test",
    placeHolder: "Choose a deployment provider",
  });

  if (!selection) {
    return;
  }

  if (!hasToken(selection.provider)) {
    vscode.window.showWarningMessage(
      `${PROVIDER_INFO[selection.provider].name} token is not configured.`,
    );
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Testing ${PROVIDER_INFO[selection.provider].name} connection...`,
    },
    async () => {
      const result = await testProviderConnection(selection.provider);
      
      if (result.valid) {
        vscode.window.showInformationMessage(`✅ ${result.message}`);
      } else {
        vscode.window.showErrorMessage(`❌ ${result.message}`);
      }
    },
  );
}

/**
 * Update deployment status command (legacy)
 */
export async function updateDeploymentStatusCmd(
  apiId: string,
  deploymentId: string,
) {
  const status = await vscode.window.showQuickPick(
    ["PENDING", "IN_PROGRESS", "DEPLOYED", "FAILED", "ROLLED_BACK"].map(
      (s) => ({ label: s, value: s }),
    ),
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

/**
 * Show deployment history command
 */
export async function showDeploymentHistoryCmd(apiId?: string) {
  let targetApiId = apiId;

  if (!targetApiId) {
    const apis = await apisApi.list();
    const pick = await vscode.window.showQuickPick(
      apis.map((a) => ({
        label: a.name,
        value: a.id,
      })),
      { title: "Select API to view deployment history" },
    );

    if (!pick) {
      return;
    }
    targetApiId = pick.value;
  }

  const deployments = await deploymentsApi.list(targetApiId);

  if (!deployments.length) {
    vscode.window.showInformationMessage("No deployments found for this API.");
    return;
  }

  // Sort by date descending
  deployments.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const picks = deployments.map((d) => {
    const date = new Date(d.created_at).toLocaleString();
    const url = deploymentsApi.getUrl(d);
    const statusIcon = d.status === "DEPLOYED" ? "✅" : d.status === "FAILED" ? "❌" : "⏳";
    
    return {
      label: `${statusIcon} ${d.provider || "Unknown"} - ${d.status}`,
      description: date,
      detail: url || deploymentsApi.getError(d) || "",
      deployment: d,
    };
  });

  const selection = await vscode.window.showQuickPick(picks, {
    title: "Deployment History",
    placeHolder: "Select a deployment to view details",
  });

  if (selection && selection.deployment) {
    const d = selection.deployment;
    const url = deploymentsApi.getUrl(d);
    const error = deploymentsApi.getError(d);

    if (url) {
      const action = await vscode.window.showInformationMessage(
        `Deployment: ${d.status}\nProvider: ${d.provider}\nURL: ${url}`,
        "Open URL",
      );
      if (action === "Open URL") {
        vscode.env.openExternal(vscode.Uri.parse(url));
      }
    } else if (error) {
      vscode.window.showErrorMessage(`Deployment failed: ${error}`);
    } else {
      vscode.window.showInformationMessage(
        `Deployment: ${d.status}\nProvider: ${d.provider}`,
      );
    }
  }
}
