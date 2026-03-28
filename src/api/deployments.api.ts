import { getApi, unwrap } from "./client";

export type DeploymentStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "DEPLOYED"
  | "FAILED"
  | "ROLLED_BACK";

export type DeploymentEnvironment = "DEVELOPMENT" | "STAGING" | "PRODUCTION";

export interface Deployment {
  id: string;
  api_id: string;
  generation_session_id: string | null;
  environment: DeploymentEnvironment;
  status: DeploymentStatus;
  provider: string | null;
  metadata_json: any;
  created_at: string;
  updated_at: string;
}

export interface DeploymentWithDetails extends Deployment {
  url?: string;
  error?: string;
  errorCode?: string;
}

export const deploymentsApi = {
  list: async (apiId: string): Promise<Deployment[]> =>
    unwrap(await getApi().get(`/api/apis/${apiId}/deployments`)),

  getById: async (apiId: string, id: string): Promise<Deployment> =>
    unwrap(await getApi().get(`/api/apis/${apiId}/deployments/${id}`)),

  create: async (
    apiId: string,
    data: {
      environment?: string;
      status?: string;
      provider?: string;
      metadata_json?: any;
      generation_session_id?: string;
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

  /** Get the latest deployment for an API */
  getLatest: async (apiId: string): Promise<Deployment | null> => {
    const deployments = await deploymentsApi.list(apiId);
    if (deployments.length === 0) {
      return null;
    }
    // Sort by created_at descending
    deployments.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return deployments[0];
  },

  /** Get deployment URL from metadata */
  getUrl: (deployment: Deployment): string | undefined => {
    return deployment.metadata_json?.url;
  },

  /** Get deployment error from metadata */
  getError: (deployment: Deployment): string | undefined => {
    return deployment.metadata_json?.error;
  },

  /** Check if deployment succeeded */
  isSuccessful: (deployment: Deployment): boolean => {
    return deployment.status === "DEPLOYED";
  },

  /** Check if deployment failed */
  isFailed: (deployment: Deployment): boolean => {
    return deployment.status === "FAILED" || deployment.status === "ROLLED_BACK";
  },

  /** Check if deployment is in progress */
  isInProgress: (deployment: Deployment): boolean => {
    return (
      deployment.status === "PENDING" || deployment.status === "IN_PROGRESS"
    );
  },

  /** Get deployment with extracted details */
  getWithDetails: async (
    apiId: string,
    id: string
  ): Promise<DeploymentWithDetails> => {
    const deployment = await deploymentsApi.getById(apiId, id);
    return {
      ...deployment,
      url: deployment.metadata_json?.url,
      error: deployment.metadata_json?.error,
      errorCode: deployment.metadata_json?.errorCode,
    };
  },

  /** Fix workflows */
  fixWithAI: async (apiId: string, id: string, prompt?: string): Promise<any> =>
    unwrap(await getApi().post(`/api/apis/${apiId}/deployments/${id}/fix-with-ai`, { prompt })),

  autoFix: async (apiId: string, id: string): Promise<any> =>
    unwrap(await getApi().post(`/api/apis/${apiId}/deployments/${id}/auto-fix`)),

  markUserFix: async (apiId: string, id: string): Promise<any> =>
    unwrap(await getApi().post(`/api/apis/${apiId}/deployments/${id}/mark-user-fix`)),

  getLogs: async (apiId: string, id: string): Promise<{errorMsg: string, metadataJson: any}> =>
    unwrap(await getApi().get(`/api/apis/${apiId}/deployments/${id}/logs`)),
};
