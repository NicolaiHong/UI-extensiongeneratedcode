import { getApi } from "./client";

export interface GenerateChange { fileName: string; codeContent: string; }
export interface GenerateResult { success: boolean; changes: GenerateChange[]; summary: string; }

export const generateApi = {
  generate: async (data: { prompt: string; provider?: string; model?: string; apiId?: string }): Promise<GenerateResult> =>
    (await getApi().post("/api/generate", data)).data,
};
