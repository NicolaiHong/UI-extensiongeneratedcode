/**
 * Deployment Types
 *
 * Core type definitions for the deployment workflow supporting
 * Vercel, Render, and GitHub Pages deployment targets.
 */

/**
 * Supported deployment providers
 */
export enum DeploymentProvider {
  VERCEL = "VERCEL",
  RENDER = "RENDER",
  GITHUB_PAGES = "GITHUB_PAGES",
}

/**
 * Deployment execution states
 */
export enum DeploymentState {
  PENDING = "PENDING",
  VALIDATING = "VALIDATING",
  UPLOADING = "UPLOADING",
  BUILDING = "BUILDING",
  DEPLOYING = "DEPLOYING",
  DEPLOYED = "DEPLOYED",
  FAILED = "FAILED",
}

/**
 * API workflow states (mirrors backend)
 *
 * State Machine:
 * - CONFIGURED → UI_GENERATED → CODE_GENERATED → READY_TO_DEPLOY → DEPLOY_QUEUED → DEPLOYING → DEPLOYED
 *                                                                                              ↓
 *                                                                                        DEPLOY_FAILED
 *                                                                                              ↓
 *                                                                               (retry) → DEPLOYING
 */
export type WorkflowState =
  | "CONFIGURED"
  | "UI_GENERATED"
  | "CODE_GENERATED"
  | "READY_TO_DEPLOY"
  | "DEPLOY_QUEUED"
  | "DEPLOYING"
  | "DEPLOYED"
  | "DEPLOY_FAILED"
  | "FAILED"
  | null;

/**
 * States that allow deployment to start
 */
export const DEPLOYABLE_STATES: WorkflowState[] = [
  "CODE_GENERATED",
  "READY_TO_DEPLOY",
  "DEPLOY_FAILED",
  "FAILED",
];

/**
 * States that indicate deployment is in progress
 */
export const DEPLOYMENT_IN_PROGRESS_STATES: WorkflowState[] = [
  "DEPLOY_QUEUED",
  "DEPLOYING",
];

/**
 * Generated file from code generation session
 */
export interface GeneratedFile {
  path: string;
  content: string;
  lang?: string;
  lines?: number;
}

/**
 * Provider-specific configuration
 */
export interface ProviderConfig {
  provider: DeploymentProvider;
  token?: string;
  projectName: string;
  teamId?: string;

  // Vercel-specific
  vercelProjectId?: string;

  // Render-specific
  renderServiceId?: string;

  // GitHub Pages-specific
  githubRepo?: string;
  githubBranch?: string;
  githubOwner?: string;
}

/**
 * Result from a deployment operation
 */
export interface DeploymentResult {
  success: boolean;
  provider: DeploymentProvider;
  state: DeploymentState;

  // Success fields
  deploymentId?: string;
  url?: string;

  // Failure fields
  error?: string;
  errorCode?: string;

  // Metadata
  startedAt?: Date;
  completedAt?: Date;
  buildLogs?: string;
}

/**
 * Deployment job tracking
 */
export interface DeploymentJob {
  id: string;
  apiId: string;
  sessionId?: string;
  provider: DeploymentProvider;
  state: DeploymentState;
  config: ProviderConfig;
  result?: DeploymentResult;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Prerequisites validation result
 */
export interface PrerequisiteResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Provider status check result
 */
export interface ProviderStatusResult {
  available: boolean;
  authenticated: boolean;
  tokenValid: boolean;
  error?: string;
}

/**
 * Deployment progress update
 */
export interface DeploymentProgress {
  state: DeploymentState;
  message: string;
  percentage?: number;
  logs?: string[];
}

/**
 * Provider metadata for UI display
 */
export interface ProviderInfo {
  id: DeploymentProvider;
  name: string;
  description: string;
  icon: string;
  requiresToken: boolean;
  tokenSettingKey: string;
  docsUrl: string;
}

/**
 * Provider registry with metadata
 */
export const PROVIDER_INFO: Record<DeploymentProvider, ProviderInfo> = {
  [DeploymentProvider.VERCEL]: {
    id: DeploymentProvider.VERCEL,
    name: "Vercel",
    description: "Deploy to Vercel's edge network",
    icon: "$(cloud-upload)",
    requiresToken: true,
    tokenSettingKey: "uigenai.vercelToken",
    docsUrl: "https://vercel.com/docs",
  },
  [DeploymentProvider.RENDER]: {
    id: DeploymentProvider.RENDER,
    name: "Render",
    description: "Deploy to Render's cloud platform",
    icon: "$(cloud-upload)",
    requiresToken: true,
    tokenSettingKey: "uigenai.renderToken",
    docsUrl: "https://render.com/docs",
  },
  [DeploymentProvider.GITHUB_PAGES]: {
    id: DeploymentProvider.GITHUB_PAGES,
    name: "GitHub Pages",
    description: "Deploy to GitHub Pages",
    icon: "$(github)",
    requiresToken: true,
    tokenSettingKey: "uigenai.githubToken",
    docsUrl: "https://docs.github.com/pages",
  },
};

/**
 * Check if a workflow state allows deployment
 */
export function canDeploy(state: WorkflowState): boolean {
  return DEPLOYABLE_STATES.includes(state);
}

/**
 * Check if a workflow state indicates deployment is in progress
 */
export function isDeploymentInProgress(state: WorkflowState): boolean {
  return DEPLOYMENT_IN_PROGRESS_STATES.includes(state);
}

/**
 * Check if a workflow state indicates deployment is complete
 */
export function isDeployed(state: WorkflowState): boolean {
  return state === "DEPLOYED";
}

/**
 * Check if a workflow state indicates deployment is in progress
 */
export function isDeploying(state: WorkflowState): boolean {
  return state === "DEPLOYING" || state === "DEPLOY_QUEUED";
}

/**
 * Check if deployment failed
 */
export function isDeployFailed(state: WorkflowState): boolean {
  return state === "DEPLOY_FAILED" || state === "FAILED";
}

/**
 * Get human-readable state label
 */
export function getStateLabel(state: DeploymentState): string {
  const labels: Record<DeploymentState, string> = {
    [DeploymentState.PENDING]: "Pending",
    [DeploymentState.VALIDATING]: "Validating...",
    [DeploymentState.UPLOADING]: "Uploading files...",
    [DeploymentState.BUILDING]: "Building...",
    [DeploymentState.DEPLOYING]: "Deploying...",
    [DeploymentState.DEPLOYED]: "Deployed",
    [DeploymentState.FAILED]: "Failed",
  };
  return labels[state] || state;
}
