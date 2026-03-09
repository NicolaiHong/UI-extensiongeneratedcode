import { getApi } from "./client";

export interface GenerateChange { fileName: string; codeContent: string; }
export interface GenerateResult { success: boolean; changes: GenerateChange[]; summary: string; }
export interface PromptTemplate { id: string; label: string; description: string; prompt: string; }

export const generateApi = {
  generate: async (data: { prompt: string; provider?: string; model?: string; apiId?: string }): Promise<GenerateResult> =>
    (await getApi().post("/api/generate", data)).data,
  getTemplates: async (): Promise<PromptTemplate[]> => {
    const res = (await getApi().get("/api/generate/templates")).data;
    return res.templates ?? res.data ?? [];
  },
};
