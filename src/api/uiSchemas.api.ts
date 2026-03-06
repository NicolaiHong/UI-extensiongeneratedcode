import { getApi } from "./client";

export interface UiSchema {
  id: string; api_id: string; name: string; schema_json: any;
  created_at: string; updated_at: string;
}

const unwrap = (r: any) => r.data?.data ?? r.data;

export const uiSchemasApi = {
  list: async (apiId: string): Promise<UiSchema[]> =>
    unwrap(await getApi().get(`/api/apis/${apiId}/ui-schemas`)),
  getById: async (apiId: string, id: string): Promise<UiSchema> =>
    unwrap(await getApi().get(`/api/apis/${apiId}/ui-schemas/${id}`)),
  create: async (apiId: string, data: { name: string; schema_json: any }): Promise<UiSchema> =>
    unwrap(await getApi().post(`/api/apis/${apiId}/ui-schemas`, data)),
  update: async (apiId: string, id: string, data: Partial<UiSchema>): Promise<UiSchema> =>
    unwrap(await getApi().put(`/api/apis/${apiId}/ui-schemas/${id}`, data)),
  delete: async (apiId: string, id: string): Promise<void> => {
    await getApi().delete(`/api/apis/${apiId}/ui-schemas/${id}`);
  },
};
