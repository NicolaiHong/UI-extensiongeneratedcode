import { getApi, unwrap } from "./client";

export type DocumentType =
  | "OPENAPI"
  | "ENTITY_SCHEMA"
  | "ACTION_SPEC"
  | "DESIGN_SYSTEM";

export interface ApiDocument {
  id: string;
  api_id: string;
  type: DocumentType;
  name: string;
  content: string;
  content_type: string | null;
  sha256: string;
  created_at: string;
  updated_at: string;
}

export const apiDocumentsApi = {
  /** List all documents for an API */
  list: async (apiId: string): Promise<ApiDocument[]> =>
    unwrap(await getApi().get(`/api/apis/${apiId}/documents`)),

  /** Get a specific document by type */
  get: async (apiId: string, type: DocumentType): Promise<ApiDocument> =>
    unwrap(await getApi().get(`/api/apis/${apiId}/documents/${type}`)),

  /** Create or update a document */
  upsert: async (
    apiId: string,
    type: DocumentType,
    data: {
      name: string;
      content: string;
      content_type?: string;
    },
  ): Promise<ApiDocument> =>
    unwrap(await getApi().put(`/api/apis/${apiId}/documents/${type}`, data)),

  /** Delete a document */
  delete: async (apiId: string, type: DocumentType): Promise<void> => {
    await getApi().delete(`/api/apis/${apiId}/documents/${type}`);
  },
};
