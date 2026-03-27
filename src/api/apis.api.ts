import { getApi, unwrap } from "./client";
import type { Session } from "./sessions.api";

/**
 * API Workflow States
 *
 * State Machine:
 * - CONFIGURED: Initial state, API is configured but no generation done
 * - UI_GENERATED: Preview/UI generation completed
 * - CODE_GENERATED: Full source code generation completed (can deploy from here)
 * - READY_TO_DEPLOY: Explicitly marked ready (optional step)
 * - DEPLOY_QUEUED: Deployment job queued
 * - DEPLOYING: Deployment in progress
 * - DEPLOYED: Successfully deployed
 * - DEPLOY_FAILED: Deployment failed (can retry)
 * - FAILED: General failure state (legacy)
 */
export type WorkflowState =
  | "CONFIGURED"
  | "UI_GENERATED"
  | "CODE_GENERATED"
  | "READY_TO_DEPLOY"
  | "DEPLOY_QUEUED"
  | "DEPLOYING"
  | "DEPLOYED"
  | "DEPLOY_FAILED"
  | "FAILED"
  | null;

/**
 * States that allow deployment to start
 */
export const DEPLOYABLE_STATES: WorkflowState[] = [
  "CODE_GENERATED",
  "READY_TO_DEPLOY",
  "DEPLOY_FAILED",
  "FAILED",
];

/**
 * States that indicate deployment is in progress (no new deployment allowed)
 */
export const DEPLOYMENT_IN_PROGRESS_STATES: WorkflowState[] = [
  "DEPLOY_QUEUED",
  "DEPLOYING",
];

/**
 * States that are "at or beyond" ready-to-deploy (idempotent for markReadyToDeploy)
 */
export const READY_OR_BEYOND_STATES: WorkflowState[] = [
  "READY_TO_DEPLOY",
  "DEPLOY_QUEUED",
  "DEPLOYING",
  "DEPLOYED",
  "DEPLOY_FAILED",
  "FAILED",
];

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

  /** Validated transition to READY_TO_DEPLOY (idempotent) */
  markReadyToDeploy: async (id: string): Promise<Api> => {
    try {
      return unwrap(await getApi().post(`/api/apis/${id}/ready-to-deploy`));
    } catch (e: any) {
      // Handle idempotent case - if already ready or beyond, treat as success
      if (e?.response?.status === 400) {
        const api = await apisApi.getById(id);
        // If already in a deploy-ready or later state, return success (idempotent)
        if (READY_OR_BEYOND_STATES.includes(api.workflow_state)) {
          console.log(`[apisApi] markReadyToDeploy idempotent: state=${api.workflow_state}`);
          return api;
        }
      }
      throw e;
    }
  },

  /** Check if API is ready for deployment */
  canDeploy: (api: Api): boolean => {
    return DEPLOYABLE_STATES.includes(api.workflow_state);
  },

  /** Check if deployment is in progress (should not start new deployment) */
  isDeploymentInProgress: (api: Api): boolean => {
    return DEPLOYMENT_IN_PROGRESS_STATES.includes(api.workflow_state);
  },

  /** Check if API has been deployed */
  isDeployed: (api: Api): boolean => {
    return api.workflow_state === "DEPLOYED";
  },

  /** Check if deployment is in progress */
  isDeploying: (api: Api): boolean => {
    return api.workflow_state === "DEPLOYING" || api.workflow_state === "DEPLOY_QUEUED";
  },

  /** Check if deployment failed (can retry) */
  isDeployFailed: (api: Api): boolean => {
    return api.workflow_state === "DEPLOY_FAILED" || api.workflow_state === "FAILED";
  },

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
      customPrompt?: string;
    },
  ): Promise<Session> =>
    unwrap(await getApi().post(`/api/apis/${id}/sessions/run`, data)),

  /** Get a specific session for this API */
  getSession: async (id: string, sessionId: string): Promise<Session> =>
    unwrap(await getApi().get(`/api/apis/${id}/sessions/${sessionId}`)),

  /** Delete a specific session for this API */
  deleteSession: async (id: string, sessionId: string): Promise<void> => {
    await getApi().delete(`/api/apis/${id}/sessions/${sessionId}`);
  },
};
