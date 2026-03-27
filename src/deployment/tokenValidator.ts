/**
 * Token Validator
 * 
 * Validates deployment provider tokens and provides setup guidance.
 */

import * as vscode from "vscode";
import { DeploymentProvider, PROVIDER_INFO } from "./types";

export interface TokenValidationResult {
  valid: boolean;
  configured: boolean;
  message: string;
}

/**
 * Get token for a provider from settings
 */
export function getProviderToken(provider: DeploymentProvider): string | undefined {
  const config = vscode.workspace.getConfiguration("uigenai");
  
  switch (provider) {
    case DeploymentProvider.VERCEL:
      return config.get<string>("vercelToken");
    case DeploymentProvider.RENDER:
      return config.get<string>("renderToken");
    case DeploymentProvider.GITHUB_PAGES:
      return config.get<string>("githubToken");
    default:
      return undefined;
  }
}

/**
 * Check if a provider has a token configured
 */
export function hasToken(provider: DeploymentProvider): boolean {
  const token = getProviderToken(provider);
  return !!token && token.trim().length > 0;
}

/**
 * Validate token format (basic validation)
 */
export function validateTokenFormat(
  provider: DeploymentProvider,
  token: string
): TokenValidationResult {
  if (!token || token.trim().length === 0) {
    return {
      valid: false,
      configured: false,
      message: `${PROVIDER_INFO[provider].name} token is not configured`,
    };
  }

  const trimmed = token.trim();

  switch (provider) {
    case DeploymentProvider.VERCEL:
      // Vercel tokens are typically 24+ characters
      if (trimmed.length < 20) {
        return {
          valid: false,
          configured: true,
          message: "Vercel token appears to be too short",
        };
      }
      break;

    case DeploymentProvider.RENDER:
      // Render API keys start with 'rnd_'
      if (!trimmed.startsWith("rnd_")) {
        return {
          valid: false,
          configured: true,
          message: "Render API key should start with 'rnd_'",
        };
      }
      break;

    case DeploymentProvider.GITHUB_PAGES:
      // GitHub tokens start with 'ghp_' (classic) or 'github_pat_' (fine-grained)
      if (!trimmed.startsWith("ghp_") && !trimmed.startsWith("github_pat_")) {
        return {
          valid: false,
          configured: true,
          message:
            "GitHub token should start with 'ghp_' or 'github_pat_'",
        };
      }
      break;
  }

  return {
    valid: true,
    configured: true,
    message: `${PROVIDER_INFO[provider].name} token is configured`,
  };
}

/**
 * Test provider connectivity with token
 */
export async function testProviderConnection(
  provider: DeploymentProvider
): Promise<TokenValidationResult> {
  const token = getProviderToken(provider);
  
  if (!token) {
    return {
      valid: false,
      configured: false,
      message: `${PROVIDER_INFO[provider].name} token is not configured`,
    };
  }

  // Validate format first
  const formatResult = validateTokenFormat(provider, token);
  if (!formatResult.valid) {
    return formatResult;
  }

  try {
    switch (provider) {
      case DeploymentProvider.VERCEL:
        return await testVercelConnection(token);
      case DeploymentProvider.RENDER:
        return await testRenderConnection(token);
      case DeploymentProvider.GITHUB_PAGES:
        return await testGitHubConnection(token);
      default:
        return {
          valid: false,
          configured: true,
          message: "Unknown provider",
        };
    }
  } catch (e: any) {
    return {
      valid: false,
      configured: true,
      message: `Connection test failed: ${e.message}`,
    };
  }
}

async function testVercelConnection(token: string): Promise<TokenValidationResult> {
  try {
    const response = await fetch("https://api.vercel.com/v2/user", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        valid: true,
        configured: true,
        message: `Connected as ${data.user?.username || data.username || "Vercel user"}`,
      };
    } else if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        configured: true,
        message: "Invalid or expired Vercel token",
      };
    } else {
      return {
        valid: false,
        configured: true,
        message: `Vercel API error: ${response.status}`,
      };
    }
  } catch (e: any) {
    return {
      valid: false,
      configured: true,
      message: `Cannot connect to Vercel: ${e.message}`,
    };
  }
}

async function testRenderConnection(token: string): Promise<TokenValidationResult> {
  try {
    const response = await fetch("https://api.render.com/v1/owners", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (response.ok) {
      return {
        valid: true,
        configured: true,
        message: "Connected to Render",
      };
    } else if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        configured: true,
        message: "Invalid or expired Render API key",
      };
    } else {
      return {
        valid: false,
        configured: true,
        message: `Render API error: ${response.status}`,
      };
    }
  } catch (e: any) {
    return {
      valid: false,
      configured: true,
      message: `Cannot connect to Render: ${e.message}`,
    };
  }
}

async function testGitHubConnection(token: string): Promise<TokenValidationResult> {
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        valid: true,
        configured: true,
        message: `Connected as ${data.login}`,
      };
    } else if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        configured: true,
        message: "Invalid or expired GitHub token",
      };
    } else {
      return {
        valid: false,
        configured: true,
        message: `GitHub API error: ${response.status}`,
      };
    }
  } catch (e: any) {
    return {
      valid: false,
      configured: true,
      message: `Cannot connect to GitHub: ${e.message}`,
    };
  }
}

/**
 * Prompt user to set up a provider token
 */
export async function promptTokenSetup(
  provider: DeploymentProvider
): Promise<boolean> {
  const info = PROVIDER_INFO[provider];
  
  const action = await vscode.window.showWarningMessage(
    `${info.name} token is not configured. You need an API token to deploy.`,
    "Set Token",
    "Open Docs",
    "Cancel"
  );

  if (action === "Set Token") {
    const token = await vscode.window.showInputBox({
      title: `Enter ${info.name} API Token`,
      password: true,
      placeHolder: "Paste your API token here",
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return "Token is required";
        }
        const result = validateTokenFormat(provider, value);
        if (!result.valid && result.configured) {
          return result.message;
        }
        return undefined;
      },
    });

    if (token) {
      const config = vscode.workspace.getConfiguration("uigenai");
      const settingKey = info.tokenSettingKey.replace("uigenai.", "");
      await config.update(settingKey, token, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`${info.name} token saved.`);
      return true;
    }
  } else if (action === "Open Docs") {
    vscode.env.openExternal(vscode.Uri.parse(info.docsUrl));
  }

  return false;
}

/**
 * Get all provider statuses
 */
export async function getAllProviderStatuses(): Promise<
  Map<DeploymentProvider, TokenValidationResult>
> {
  const results = new Map<DeploymentProvider, TokenValidationResult>();
  
  for (const provider of Object.values(DeploymentProvider)) {
    const token = getProviderToken(provider);
    if (token) {
      results.set(provider, await testProviderConnection(provider));
    } else {
      results.set(provider, {
        valid: false,
        configured: false,
        message: `${PROVIDER_INFO[provider].name} token not configured`,
      });
    }
  }

  return results;
}
