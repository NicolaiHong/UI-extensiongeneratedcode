import { getApi, unwrap } from "./client";

export interface Session {
  id: string;
  project_id: string;
  provider: string;
  model: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  error_message: string | null;
  output_summary_md: string | null;
  created_at: string;
  finished_at: string | null;
}

export const sessionsApi = {
  list: async (projectId: string): Promise<Session[]> =>
    unwrap(await getApi().get(`/api/projects/${projectId}/sessions`)),

  getById: async (projectId: string, id: string): Promise<Session> =>
    unwrap(await getApi().get(`/api/projects/${projectId}/sessions/${id}`)),

  run: async (
    projectId: string,
    data: {
      provider?: string;
      model?: string;
      framework?: string;
      cssStrategy?: string;
    },
  ): Promise<Session> =>
    unwrap(
      await getApi().post(`/api/projects/${projectId}/sessions/run`, data),
    ),

  delete: async (projectId: string, id: string): Promise<void> => {
    await getApi().delete(`/api/projects/${projectId}/sessions/${id}`);
  },
};
