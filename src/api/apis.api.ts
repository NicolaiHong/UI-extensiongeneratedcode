import { getApi, unwrap } from "./client";
import type { Session } from "./sessions.api";

export type WorkflowState =
  | "CONFIGURED"
  | "UI_GENERATED"
  | "CODE_GENERATED"
  | "READY_TO_DEPLOY"
  | "DEPLOYING"
  | "DEPLOYED"
  | "FAILED"
  | null;

export interface Api {
  id: string;
  owner_developer_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  base_url: string | null;
  version: string | null;
  status: "ACTIVE" | "INACTIVE" | "DEPRECATED";
  workflow_state: WorkflowState;
  created_at: string;
  updated_at: string;
}

export const apisApi = {
  list: async (): Promise<Api[]> => unwrap(await getApi().get("/api/apis")),
  getById: async (id: string): Promise<Api> =>
    unwrap(await getApi().get(`/api/apis/${id}`)),
  create: async (data: {
    name: string;
    description?: string;
    base_url?: string;
    version?: string;
    project_id?: string;
    status?: string;
  }): Promise<Api> => unwrap(await getApi().post("/api/apis", data)),
  update: async (id: string, data: Partial<Api>): Promise<Api> =>
    unwrap(await getApi().put(`/api/apis/${id}`, data)),
  delete: async (id: string): Promise<void> => {
    await getApi().delete(`/api/apis/${id}`);
  },

  /** Update only the workflow state */
  updateWorkflowState: async (
    id: string,
    workflow_state: NonNullable<WorkflowState>,
  ): Promise<Api> =>
    unwrap(
      await getApi().patch(`/api/apis/${id}/workflow-state`, {
        workflow_state,
      }),
    ),

  /** Validated transition to READY_TO_DEPLOY */
  markReadyToDeploy: async (id: string): Promise<Api> =>
    unwrap(await getApi().post(`/api/apis/${id}/ready-to-deploy`)),

  /** List generation sessions scoped to this API */
  listSessions: async (
    id: string,
    mode?: "PREVIEW" | "FULL_SOURCE",
  ): Promise<any[]> =>
    unwrap(
      await getApi().get(`/api/apis/${id}/sessions`, {
        params: mode ? { mode } : undefined,
      }),
    ),

  /** Run a generation session for this API (no project required) */
  runSession: async (
    id: string,
    data: {
      provider?: string;
      model?: string;
      framework?: string;
      cssStrategy?: string;
      mode?: "PREVIEW" | "FULL_SOURCE";
    },
  ): Promise<Session> =>
    unwrap(await getApi().post(`/api/apis/${id}/sessions/run`, data)),

  /** Get a specific session for this API */
  getSession: async (id: string, sessionId: string): Promise<Session> =>
    unwrap(await getApi().get(`/api/apis/${id}/sessions/${sessionId}`)),
};
