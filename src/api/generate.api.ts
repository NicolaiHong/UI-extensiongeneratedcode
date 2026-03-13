import { getApi, unwrap } from "./client";

export interface GenerateChange {
  fileName: string;
  codeContent: string;
}
export interface GenerateResult {
  success: boolean;
  changes: GenerateChange[];
  summary: string;
}
export interface PromptTemplate {
  id: string;
  label: string;
  description: string;
  prompt: string;
}

export const generateApi = {
  generate: async (data: {
    prompt: string;
    provider?: string;
    model?: string;
    apiId?: string;
  }): Promise<GenerateResult> =>
    unwrap(await getApi().post("/api/generate", data)),
  getTemplates: async (): Promise<PromptTemplate[]> => {
    const res = unwrap(await getApi().get("/api/generate/templates"));
    return res.templates ?? res.data ?? res;
  },
};
