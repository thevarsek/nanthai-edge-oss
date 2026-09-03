export interface ModelMediaCapabilities {
  image?: {
    counts: number[];
    countMin?: number;
    countMax?: number;
    aspectRatios: string[];
    resolutions: string[];
    sizes: string[];
    qualities: string[];
    backgrounds: string[];
    outputFormats: string[];
    supportsOutputCompression: boolean;
    outputCompressionMin?: number;
    outputCompressionMax?: number;
    maxInputReferences?: number;
    supportsStreaming: boolean;
  };
  video?: {
    resolutions: string[];
    aspectRatios: string[];
    durations: number[];
    frameImages: string[];
    supportsAudio: boolean;
    supportsSeed: boolean;
  };
  speech?: {
    voices: string[];
    outputFormats: Array<"mp3" | "pcm">;
    supportsSpeed: boolean;
    speedMin?: number;
    speedMax?: number;
    supportsInstructions: boolean;
    supportsStyle: boolean;
    styleDegreeMin?: number;
    styleDegreeMax?: number;
  };
}

interface CapabilityDescriptor {
  type?: string;
  values?: string[];
  min?: number;
  max?: number;
}

export interface MediaCapabilitySource {
  modelId?: string;
  supportsImages?: boolean;
  supportedVoices?: string[];
  architecture?: {
    tokenizer?: string;
    instructType?: string;
    modality?: string;
  };
  imageCapabilities?: {
    isAvailable?: boolean;
    supportedParameters?: Record<string, CapabilityDescriptor>;
    supportsStreaming?: boolean;
    maxInputReferences?: number;
  };
  videoCapabilities?: {
    supportedResolutions?: string[];
    supportedAspectRatios?: string[];
    supportedDurations?: number[];
    supportedFrameImages?: string[];
    generateAudio?: boolean;
    seed?: boolean;
  };
}

function hasSpeechOutput(modality: string | undefined): boolean {
  return (modality?.split("->", 2)[1] ?? "")
    .split("+")
    .some((value) => value.trim() === "speech");
}

function projectSpeechCapabilities(
  model: MediaCapabilitySource,
): NonNullable<ModelMediaCapabilities["speech"]> | undefined {
  if (!hasSpeechOutput(model.architecture?.modality)) return undefined;

  const modelId = model.modelId ?? "";
  const isOpenAIGptTts = modelId.startsWith("openai/") && modelId.includes("gpt-");
  const isMicrosoftMaiVoice = modelId.startsWith("microsoft/mai-voice-2");
  const supportsSpeed = isOpenAIGptTts || isMicrosoftMaiVoice;

  return {
    voices: uniqueStrings(model.supportedVoices),
    outputFormats: ["mp3", "pcm"],
    supportsSpeed,
    speedMin: isOpenAIGptTts ? 0.25 : isMicrosoftMaiVoice ? 0.5 : undefined,
    speedMax: isOpenAIGptTts ? 4 : isMicrosoftMaiVoice ? 2 : undefined,
    supportsInstructions: isOpenAIGptTts,
    supportsStyle: isMicrosoftMaiVoice,
    styleDegreeMin: isMicrosoftMaiVoice ? 0.01 : undefined,
    styleDegreeMax: isMicrosoftMaiVoice ? 2 : undefined,
  };
}

function uniqueStrings(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).filter((value) => value.length > 0)));
}

function uniqueNumbers(values: number[] | undefined): number[] {
  return Array.from(new Set((values ?? []).filter(Number.isFinite)));
}

function descriptorValues(
  parameters: Record<string, CapabilityDescriptor>,
  name: string,
): string[] {
  return uniqueStrings(parameters[name]?.values);
}

function countCapabilities(
  descriptor: CapabilityDescriptor | undefined,
): { counts: number[]; countMin?: number; countMax?: number } {
  const enumCounts = (descriptor?.values ?? [])
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (descriptor?.values !== undefined) {
    const counts = Array.from(new Set(enumCounts)).sort((left, right) => left - right);
    return {
      counts,
      countMin: counts[0],
      countMax: counts.at(-1),
    };
  }
  const countMin = descriptor?.min;
  const countMax = descriptor?.max;
  return {
    counts: [],
    countMin: Number.isFinite(countMin) ? countMin : undefined,
    countMax: Number.isFinite(countMax) ? countMax : undefined,
  };
}

export function isImageGenerationAvailable(
  model: MediaCapabilitySource,
): boolean {
  if (model.imageCapabilities?.isAvailable === false) return false;
  return model.imageCapabilities !== undefined || model.supportsImages === true;
}

export function removeImageOutputModality(
  modality: string | undefined,
): string | undefined {
  if (!modality) return modality;
  const [input, output] = modality.split("->");
  if (output === undefined) return modality;
  const remainingOutput = output
    .split("+")
    .filter((value) => value !== "image");
  if (remainingOutput.length === 0) return undefined;
  return `${input}->${remainingOutput.join("+")}`;
}

export function projectImageAvailability(model: MediaCapabilitySource): {
  supportsImages?: boolean;
  architecture?: MediaCapabilitySource["architecture"];
} {
  if (model.imageCapabilities?.isAvailable !== false) {
    return {
      supportsImages: model.supportsImages,
      architecture: model.architecture,
    };
  }
  return {
    supportsImages: false,
    architecture: model.architecture
      ? {
          ...model.architecture,
          modality: removeImageOutputModality(model.architecture.modality),
        }
      : undefined,
  };
}

export function projectMediaCapabilities(
  model: MediaCapabilitySource,
): ModelMediaCapabilities {
  const result: ModelMediaCapabilities = {};
  if (model.imageCapabilities && isImageGenerationAvailable(model)) {
    const parameters = model.imageCapabilities.supportedParameters ?? {};
    result.image = {
      ...countCapabilities(parameters.n),
      aspectRatios: descriptorValues(parameters, "aspect_ratio"),
      resolutions: descriptorValues(parameters, "resolution"),
      sizes: descriptorValues(parameters, "size"),
      qualities: descriptorValues(parameters, "quality"),
      backgrounds: descriptorValues(parameters, "background"),
      outputFormats: descriptorValues(parameters, "output_format"),
      supportsOutputCompression: parameters.output_compression !== undefined,
      outputCompressionMin: parameters.output_compression?.min,
      outputCompressionMax: parameters.output_compression?.max,
      maxInputReferences: model.imageCapabilities.maxInputReferences,
      supportsStreaming: model.imageCapabilities.supportsStreaming === true,
    };
  }

  if (model.videoCapabilities) {
    result.video = {
      resolutions: uniqueStrings(model.videoCapabilities.supportedResolutions),
      aspectRatios: uniqueStrings(model.videoCapabilities.supportedAspectRatios),
      durations: uniqueNumbers(model.videoCapabilities.supportedDurations),
      frameImages: uniqueStrings(model.videoCapabilities.supportedFrameImages),
      supportsAudio: model.videoCapabilities.generateAudio === true,
      supportsSeed: model.videoCapabilities.seed === true,
    };
  }
  const speech = projectSpeechCapabilities(model);
  if (speech) result.speech = speech;
  return result;
}

export function projectModelMediaContract<T extends MediaCapabilitySource>(
  model: T,
): T & {
  supportsImages?: boolean;
  architecture?: MediaCapabilitySource["architecture"];
  mediaCapabilities: ModelMediaCapabilities;
} {
  const projected = { ...model, ...projectImageAvailability(model) };
  return {
    ...projected,
    mediaCapabilities: projectMediaCapabilities(projected),
  };
}
