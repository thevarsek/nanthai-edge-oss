import { ConvexError } from "convex/values";
import type { ChatRequestParameters } from "./openrouter_types";

function mediaModelFeatureError(feature: string) {
  return new ConvexError({
    code: "MEDIA_MODEL_UNSUPPORTED_FOR_TEXT",
    message: `${feature} requires a text-capable model. Choose a text model instead of a media-output model.`,
  });
}

export function assertModelAvailable(args: {
  modelId: string;
  capabilities: unknown | null | undefined;
  feature: string;
}): void {
  if (args.capabilities != null) return;
  throw new ConvexError({
    code: "MODEL_UNAVAILABLE" as const,
    message:
      `${args.feature} cannot use ${args.modelId} because it is no longer available. Choose another model and try again.`,
  });
}

export function assertTextGenerationModel(args: {
  feature: string;
  hasImageGeneration?: boolean;
  hasVideoGeneration?: boolean;
  hasAudioOutput?: boolean;
}): void {
  if (
    args.hasImageGeneration === true ||
    args.hasVideoGeneration === true ||
    args.hasAudioOutput === true
  ) {
    throw mediaModelFeatureError(args.feature);
  }
}

export function assertChatCompletionsRequest(
  params: ChatRequestParameters,
): void {
  if (params.modalities?.includes("image") || params.imageConfig != null) {
    throw new ConvexError({
      code: "IMAGE_API_REQUIRED",
      message: "Image generation must use the dedicated OpenRouter Images API.",
    });
  }
}

export async function resolveTextAncillaryModel(args: {
  selectedModel: string;
  defaultModel: string;
  feature: string;
  getCapabilities: (
    modelId: string,
  ) => Promise<{
    hasImageGeneration?: boolean;
    hasVideoGeneration?: boolean;
    hasAudioOutput?: boolean;
  } | null | undefined>;
}): Promise<string> {
  let selectedCapabilities: Awaited<ReturnType<typeof args.getCapabilities>>;
  try {
    selectedCapabilities = await args.getCapabilities(args.selectedModel);
  } catch {
    return args.defaultModel;
  }
  if (!selectedCapabilities) {
    return args.defaultModel;
  }
  const selectedIsMedia =
    selectedCapabilities.hasImageGeneration === true ||
    selectedCapabilities.hasVideoGeneration === true ||
    selectedCapabilities.hasAudioOutput === true;
  if (!selectedIsMedia) {
    return args.selectedModel;
  }
  if (args.selectedModel === args.defaultModel) {
    assertTextGenerationModel({
      feature: args.feature,
      ...selectedCapabilities,
    });
  }

  let defaultCapabilities: Awaited<ReturnType<typeof args.getCapabilities>>;
  try {
    defaultCapabilities = await args.getCapabilities(args.defaultModel);
  } catch {
    return args.defaultModel;
  }
  assertTextGenerationModel({
    feature: args.feature,
    hasImageGeneration: defaultCapabilities?.hasImageGeneration,
    hasVideoGeneration: defaultCapabilities?.hasVideoGeneration,
    hasAudioOutput: defaultCapabilities?.hasAudioOutput,
  });
  return args.defaultModel;
}
