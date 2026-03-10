import { getApi, unwrap } from "./client";

export interface Deployment {
  id: string;
  api_id: string;
  environment: "DEVELOPMENT" | "STAGING" | "PRODUCTION";
  status: "PENDING" | "IN_PROGRESS" | "DEPLOYED" | "FAILED" | "ROLLED_BACK";
  provider: string | null;
  metadata_json: any;
  created_at: string;
  updated_at: string;
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
};
