import { getApi, unwrap } from "./client";

export interface Project {
  id: string;
  developer_id: string;
  name: string;
  description: string | null;
  repo_url: string | null;
  default_branch: string | null;
  vercel_project_id: string | null;
  created_at: string;
  updated_at: string;
}

export const projectsApi = {
  list: async (): Promise<Project[]> =>
    unwrap(await getApi().get("/api/projects")),
  getById: async (id: string): Promise<Project> =>
    unwrap(await getApi().get(`/api/projects/${id}`)),
  create: async (data: {
    name: string;
    description?: string;
    repo_url?: string;
    default_branch?: string;
    vercel_project_id?: string;
  }): Promise<Project> => unwrap(await getApi().post("/api/projects", data)),
  update: async (id: string, data: Partial<Project>): Promise<Project> =>
    unwrap(await getApi().put(`/api/projects/${id}`, data)),
  delete: async (id: string): Promise<void> => {
    await getApi().delete(`/api/projects/${id}`);
  },
};
