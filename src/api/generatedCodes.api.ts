import { getApi, unwrap } from "./client";

export interface GeneratedCode {
  id: string;
  api_id: string;
  generation_session_id: string | null;
  file_path: string;
  content: string;
  language: string | null;
  created_at: string;
}

export interface GeneratedCodeWithApi extends GeneratedCode {
  api_name: string;
  apis?: {
    id: string;
    name: string;
  };
}

export interface GeneratedCodeListResponse {
  data: GeneratedCodeWithApi[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface GeneratedCodeFilters {
  search?: string;
  apiId?: string;
  language?: string;
}

export const generatedCodesApi = {
  list: async (apiId: string): Promise<GeneratedCode[]> =>
    unwrap(await getApi().get(`/api/apis/${apiId}/generated-codes`)),
  getById: async (apiId: string, id: string): Promise<GeneratedCode> =>
    unwrap(await getApi().get(`/api/apis/${apiId}/generated-codes/${id}`)),
  create: async (
    apiId: string,
    data: {
      file_path: string;
      content: string;
      language?: string;
      generation_session_id?: string;
    },
  ): Promise<GeneratedCode> =>
    unwrap(await getApi().post(`/api/apis/${apiId}/generated-codes`, data)),
  delete: async (apiId: string, id: string): Promise<void> => {
    await getApi().delete(`/api/apis/${apiId}/generated-codes/${id}`);
  },

  // Global endpoints for Code History feature
  listAll: async (
    page: number = 1,
    limit: number = 20,
    filters?: GeneratedCodeFilters,
  ): Promise<GeneratedCodeListResponse> => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });
    if (filters?.search) params.append("search", filters.search);
    if (filters?.apiId) params.append("apiId", filters.apiId);
    if (filters?.language) params.append("language", filters.language);

    const response = await getApi().get(`/api/generated-codes?${params}`);
    return response.data;
  },

  getByIdGlobal: async (id: string): Promise<GeneratedCodeWithApi> =>
    unwrap(await getApi().get(`/api/generated-codes/${id}`)),

  deleteGlobal: async (id: string): Promise<void> => {
    await getApi().delete(`/api/generated-codes/${id}`);
  },
};
