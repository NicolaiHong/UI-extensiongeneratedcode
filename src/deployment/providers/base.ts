/**
 * Base Deployment Provider Interface
 *
 * Abstract interface that all deployment providers must implement.
 * Provides a consistent API for deploying to different platforms.
 */

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

/**
 * Deployment provider interface
 *
 * All provider implementations must implement this interface to ensure
 * consistent behavior across Vercel, Render, and GitHub Pages.
 */
export interface IDeploymentProvider {
  /**
   * Provider identifier
   */
  readonly provider: DeploymentProvider;

  /**
   * Human-readable provider name
   */
  readonly name: string;

  /**
   * Check if the provider is properly configured and accessible
   */
  checkStatus(config: ProviderConfig): Promise<ProviderStatusResult>;

  /**
   * Validate that all prerequisites are met before deployment
   * - Token configured
   * - Files are valid
   * - Project structure is correct
   */
  validatePrerequisites(
    files: GeneratedFile[],
    config: ProviderConfig,
  ): Promise<PrerequisiteResult>;

  /**
   * Create a new deployment
   * Returns immediately with a deployment ID for status tracking
   */
  createDeployment(
    files: GeneratedFile[],
    config: ProviderConfig,
    onProgress?: (progress: DeploymentProgress) => void,
  ): Promise<DeploymentResult>;

  /**
   * Get the current status of a deployment
   */
  getDeploymentStatus(
    deploymentId: string,
    config: ProviderConfig,
  ): Promise<DeploymentResult>;

  /**
   * Normalize provider-specific response to standard DeploymentResult
   */
  normalizeResult(response: unknown): DeploymentResult;
}

/**
 * Base class with common functionality for all providers
 */
export abstract class BaseDeploymentProvider implements IDeploymentProvider {
  abstract readonly provider: DeploymentProvider;
  abstract readonly name: string;

  abstract checkStatus(config: ProviderConfig): Promise<ProviderStatusResult>;

  abstract validatePrerequisites(
    files: GeneratedFile[],
    config: ProviderConfig,
  ): Promise<PrerequisiteResult>;

  abstract createDeployment(
    files: GeneratedFile[],
    config: ProviderConfig,
    onProgress?: (progress: DeploymentProgress) => void,
  ): Promise<DeploymentResult>;

  abstract getDeploymentStatus(
    deploymentId: string,
    config: ProviderConfig,
  ): Promise<DeploymentResult>;

  abstract normalizeResult(response: unknown): DeploymentResult;

  /**
   * Helper to create a failed result
   */
  protected failedResult(error: string, errorCode?: string): DeploymentResult {
    return {
      success: false,
      provider: this.provider,
      state: DeploymentState.FAILED,
      error,
      errorCode,
      completedAt: new Date(),
    };
  }

  /**
   * Helper to create a successful result
   */
  protected successResult(url: string, deploymentId: string): DeploymentResult {
    return {
      success: true,
      provider: this.provider,
      state: DeploymentState.DEPLOYED,
      url,
      deploymentId,
      completedAt: new Date(),
    };
  }

  /**
   * Helper to create an in-progress result
   */
  protected progressResult(
    state: DeploymentState,
    deploymentId: string,
  ): DeploymentResult {
    return {
      success: false,
      provider: this.provider,
      state,
      deploymentId,
    };
  }

  /**
   * Validate common prerequisites
   */
  protected validateCommonPrerequisites(
    files: GeneratedFile[],
    config: ProviderConfig,
  ): PrerequisiteResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if files exist
    if (!files || files.length === 0) {
      errors.push("No files to deploy. Generate source code first.");
    }

    // Check for required files
    const hasPackageJson = files.some((f) => f.path.endsWith("package.json"));
    if (!hasPackageJson) {
      warnings.push("No package.json found. Deployment may fail.");
    }

    // Check for index/entry file
    const hasEntryFile = files.some(
      (f) =>
        f.path.endsWith("index.html") ||
        f.path.endsWith("index.tsx") ||
        f.path.endsWith("index.ts") ||
        f.path.endsWith("main.tsx") ||
        f.path.endsWith("App.tsx"),
    );
    if (!hasEntryFile) {
      warnings.push("No entry file (index.html, index.tsx, etc.) found.");
    }

    // Check project name
    if (!config.projectName) {
      errors.push("Project name is required.");
    } else if (!/^[a-z0-9-]+$/i.test(config.projectName)) {
      errors.push(
        "Project name must contain only letters, numbers, and hyphens.",
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Report progress to callback
   */
  protected reportProgress(
    onProgress: ((progress: DeploymentProgress) => void) | undefined,
    state: DeploymentState,
    message: string,
    percentage?: number,
  ): void {
    if (onProgress) {
      onProgress({ state, message, percentage });
    }
  }
}

/**
 * Provider factory type
 */
export type ProviderFactory = () => IDeploymentProvider;

/**
 * Provider registry for dynamic provider lookup
 */
const providerRegistry = new Map<DeploymentProvider, ProviderFactory>();

/**
 * Register a provider factory
 */
export function registerProvider(
  provider: DeploymentProvider,
  factory: ProviderFactory,
): void {
  providerRegistry.set(provider, factory);
}

/**
 * Get a provider instance by type
 */
export function getProvider(provider: DeploymentProvider): IDeploymentProvider {
  const factory = providerRegistry.get(provider);
  if (!factory) {
    throw new Error(`Provider not registered: ${provider}`);
  }
  return factory();
}

/**
 * Check if a provider is registered
 */
export function hasProvider(provider: DeploymentProvider): boolean {
  return providerRegistry.has(provider);
}

/**
 * Get all registered provider types
 */
export function getRegisteredProviders(): DeploymentProvider[] {
  return Array.from(providerRegistry.keys());
}
