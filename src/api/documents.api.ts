import { getApi, unwrap } from "./client";

export type DocumentType =
  | "OPENAPI"
  | "ENTITY_SCHEMA"
  | "ACTION_SPEC"
  | "DESIGN_SYSTEM";

export interface ProjectDocument {
  id: string;
  project_id: string;
  type: DocumentType;
  name: string;
  content_type: string | null;
  content: string;
  sha256: string;
  updated_at: string;
}

export const documentsApi = {
  list: async (projectId: string): Promise<ProjectDocument[]> =>
    unwrap(await getApi().get(`/api/projects/${projectId}/documents`)),

  getByType: async (
    projectId: string,
    type: DocumentType,
  ): Promise<ProjectDocument> =>
    unwrap(await getApi().get(`/api/projects/${projectId}/documents/${type}`)),

  upsert: async (
    projectId: string,
    type: DocumentType,
    data: { name: string; content: string; content_type?: string },
  ): Promise<ProjectDocument> =>
    unwrap(
      await getApi().put(`/api/projects/${projectId}/documents/${type}`, data),
    ),

  delete: async (projectId: string, type: DocumentType): Promise<void> => {
    await getApi().delete(`/api/projects/${projectId}/documents/${type}`);
  },
};
