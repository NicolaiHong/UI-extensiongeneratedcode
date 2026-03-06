import { getApi } from "./client";

export interface Api {
  id: string; owner_developer_id: string; project_id: string | null;
  name: string; description: string | null; base_url: string | null;
  version: string | null; status: "ACTIVE" | "INACTIVE" | "DEPRECATED";
  created_at: string; updated_at: string;
}

const unwrap = (r: any) => r.data?.data ?? r.data;

export const apisApi = {
  list: async (): Promise<Api[]> => unwrap(await getApi().get("/api/apis")),
  getById: async (id: string): Promise<Api> => unwrap(await getApi().get(`/api/apis/${id}`)),
  create: async (data: { name: string; description?: string; base_url?: string; version?: string; project_id?: string; status?: string }): Promise<Api> =>
    unwrap(await getApi().post("/api/apis", data)),
  update: async (id: string, data: Partial<Api>): Promise<Api> =>
    unwrap(await getApi().put(`/api/apis/${id}`, data)),
  delete: async (id: string): Promise<void> => { await getApi().delete(`/api/apis/${id}`); },
};
