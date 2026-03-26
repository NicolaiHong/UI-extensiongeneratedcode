/**
 * Deployments API Client
 *
 * Per implementation_plan_api_generation_deloyment.md:
 * - Updated status types (PENDING, READY_TO_DEPLOY, DEPLOYING, DEPLOYED, DEPLOY_FAILED)
 * - Provider types (VERCEL, RENDER, GITHUB_PAGES)
 * - Readiness check, mark ready, start deployment endpoints
 */

import { getApi, unwrap } from "./client";

export type DeploymentStatus =
  | "PENDING"
  | "READY_TO_DEPLOY"
  | "DEPLOYING"
  | "DEPLOYED"
  | "DEPLOY_FAILED";

export type DeploymentProvider = "VERCEL" | "RENDER" | "GITHUB_PAGES";

export type DeploymentEnvironment = "DEVELOPMENT" | "STAGING" | "PRODUCTION";

export interface Deployment {
  id: string;
  api_id: string;
  session_id: string | null;
  environment: DeploymentEnvironment;
  status: DeploymentStatus;
  provider: DeploymentProvider | null;
  deploy_url: string | null;
  error_message: string | null;
  metadata_json: any;
  created_at: string;
  updated_at: string;
}

export interface ReadinessCheckResponse {
  deployable: boolean;
  current_status: DeploymentStatus | null;
  session_id: string | null;
  has_source_artifact: boolean;
  missing_requirements: string[];
  message: string;
}

export interface MarkReadyResponse {
  deployment: Deployment;
  already_ready: boolean;
  message: string;
}

export interface DeploymentStartResponse {
  deployment: Deployment;
  provider_deployment_id: string | null;
  message: string;
}

export const deploymentsApi = {
  // ========== EXISTING CRUD ==========

  list: async (apiId: string): Promise<Deployment[]> =>
    unwrap(await getApi().get(`/api/apis/${apiId}/deployments`)),

  getById: async (apiId: string, id: string): Promise<Deployment> =>
    unwrap(await getApi().get(`/api/apis/${apiId}/deployments/${id}`)),

  create: async (
    apiId: string,
    data: {
      session_id?: string;
      environment?: DeploymentEnvironment;
      provider?: DeploymentProvider;
      metadata_json?: any;
    },
  ): Promise<Deployment> =>
    unwrap(await getApi().post(`/api/apis/${apiId}/deployments`, data)),

  update: async (
    apiId: string,
    id: string,
    data: Partial<Deployment>,
  ): Promise<Deployment> =>
    unwrap(await getApi().put(`/api/apis/${apiId}/deployments/${id}`, data)),

  delete: async (apiId: string, id: string): Promise<void> => {
    await getApi().delete(`/api/apis/${apiId}/deployments/${id}`);
  },

  // ========== NEW DEPLOYMENT WORKFLOW ==========

  /**
   * Check if an API is ready for deployment.
   * This is idempotent and safe to call multiple times.
   */
  checkReadiness: async (
    apiId: string,
    sessionId?: string,
  ): Promise<ReadinessCheckResponse> => {
    const params = sessionId ? `?session_id=${sessionId}` : "";
    return unwrap(
      await getApi().get(`/api/apis/${apiId}/deployments/readiness${params}`),
    );
  },

  /**
   * Mark API as ready to deploy.
   * Idempotent - returns success if already ready.
   */
  markReady: async (
    apiId: string,
    sessionId: string,
  ): Promise<MarkReadyResponse> =>
    unwrap(
      await getApi().post(`/api/apis/${apiId}/deployments/ready`, {
        session_id: sessionId,
      }),
    ),

  /**
   * Start deployment to a specific provider.
   */
  startDeployment: async (
    apiId: string,
    deploymentId: string,
    data: {
      provider: DeploymentProvider;
      environment?: DeploymentEnvironment;
      config?: Record<string, unknown>;
    },
  ): Promise<DeploymentStartResponse> =>
    unwrap(
      await getApi().post(
        `/api/apis/${apiId}/deployments/${deploymentId}/start`,
        data,
      ),
    ),

  /**
   * Create and start deployment in one step.
   * Convenience method that marks ready + starts deployment.
   */
  deploy: async (
    apiId: string,
    data: {
      session_id: string;
      provider: DeploymentProvider;
      environment?: DeploymentEnvironment;
      config?: Record<string, unknown>;
    },
  ): Promise<DeploymentStartResponse> =>
    unwrap(await getApi().post(`/api/apis/${apiId}/deployments/deploy`, data)),

  /**
   * Get available deployment providers.
   */
  getProviders: async (): Promise<{ providers: DeploymentProvider[] }> =>
    unwrap(await getApi().get(`/api/deployments/providers`)),
};
