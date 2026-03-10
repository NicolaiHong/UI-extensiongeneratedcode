import { getApi, unwrap } from "./client";

export interface ApiConfig {
  id: string;
  api_id: string;
  key: string;
  value: string;
  is_secret: boolean;
  created_at: string;
  updated_at: string;
}

export const apiConfigsApi = {
  list: async (apiId: string): Promise<ApiConfig[]> =>
    unwrap(await getApi().get(`/api/apis/${apiId}/configs`)),
  getById: async (apiId: string, id: string): Promise<ApiConfig> =>
    unwrap(await getApi().get(`/api/apis/${apiId}/configs/${id}`)),
  create: async (
    apiId: string,
    data: { key: string; value: string; is_secret?: boolean },
  ): Promise<ApiConfig> =>
    unwrap(await getApi().post(`/api/apis/${apiId}/configs`, data)),
  update: async (
    apiId: string,
    id: string,
    data: Partial<ApiConfig>,
  ): Promise<ApiConfig> =>
    unwrap(await getApi().put(`/api/apis/${apiId}/configs/${id}`, data)),
  delete: async (apiId: string, id: string): Promise<void> => {
    await getApi().delete(`/api/apis/${apiId}/configs/${id}`);
  },
};
