export type RuntimeModelSelectionInput = {
  modelSelectionMode?: "adapter_default" | "explicit";
  provider?: string;
  modelId?: string;
};

export function runtimeModelSelection(input: RuntimeModelSelectionInput):
  | { mode: "adapter_default"; provider: null; modelId: null }
  | { mode: "explicit"; provider: string | null; modelId: string } {
  if (input.modelSelectionMode !== "explicit") {
    return { mode: "adapter_default", provider: null, modelId: null };
  }
  if (!input.modelId) {
    throw new Error("Explicit local model selection requires a model ID");
  }
  return {
    mode: "explicit",
    provider: input.provider ?? null,
    modelId: input.modelId,
  };
}
