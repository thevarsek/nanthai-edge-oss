import { z } from "zod";
import type { AdapterModelDescriptor } from "./protocol.ts";
import type { PiRpcClient } from "./pi_rpc_client.ts";

export const PiModelSchema = z.object({
  provider: z.string().min(1), id: z.string().min(1), name: z.string(),
  input: z.array(z.string()), reasoning: z.boolean(), baseUrl: z.string(),
});
export type PiModel = z.infer<typeof PiModelSchema>;

export async function piModels(client: PiRpcClient): Promise<AdapterModelDescriptor[]> {
  const data = z.object({ models: z.array(PiModelSchema) }).parse(await client.request("get_available_models"));
  return Promise.all(data.models.map(async model => {
    const ready = model.provider !== "ollama" || await ollamaHasModel(model);
    return {
      provider: model.provider, modelId: model.id, displayName: model.name,
      availability: ready ? "available" as const : "unavailable" as const,
      unavailableReason: ready ? null : "Start Ollama and install the configured model",
      inputModalities: model.input.includes("image") ? ["text" as const, "image" as const] : ["text" as const],
      supportsTools: true, supportsReasoning: model.reasoning,
    };
  }));
}

async function ollamaHasModel(model: PiModel): Promise<boolean> {
  try {
    const url = new URL(`${model.baseUrl.replace(/\/$/, "")}/models`);
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const result = z.object({ data: z.array(z.object({ id: z.string() })) }).parse(await response.json());
    return result.data.some(item => item.id === model.id);
  } catch { return false; }
}
