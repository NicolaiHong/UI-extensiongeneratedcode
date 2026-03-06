import { getApi } from "./client";

export interface GeneratedCode {
  id: string; api_id: string; generation_session_id: string | null;
  file_path: string; content: string; language: string | null; created_at: string;
}

const unwrap = (r: any) => r.data?.data ?? r.data;

export const generatedCodesApi = {
  list: async (apiId: string): Promise<GeneratedCode[]> =>
    unwrap(await getApi().get(`/api/apis/${apiId}/generated-codes`)),
  getById: async (apiId: string, id: string): Promise<GeneratedCode> =>
    unwrap(await getApi().get(`/api/apis/${apiId}/generated-codes/${id}`)),
  create: async (apiId: string, data: { file_path: string; content: string; language?: string; generation_session_id?: string }): Promise<GeneratedCode> =>
    unwrap(await getApi().post(`/api/apis/${apiId}/generated-codes`, data)),
  delete: async (apiId: string, id: string): Promise<void> => {
    await getApi().delete(`/api/apis/${apiId}/generated-codes/${id}`);
  },
};
