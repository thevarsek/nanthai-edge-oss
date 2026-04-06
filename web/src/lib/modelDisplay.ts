import type { ModelSummary } from "@/components/shared/ModelPickerHelpers";

export function buildModelNameMap(modelSummaries?: ModelSummary[] | null): Map<string, string> {
  return new Map((modelSummaries ?? []).map((model) => [model.modelId, model.name]));
}

export function getModelDisplayName(modelId?: string, modelNameMap?: Map<string, string>): string {
  if (!modelId) return "Assistant";
  return modelNameMap?.get(modelId) ?? modelId.split("/").pop() ?? modelId;
}
