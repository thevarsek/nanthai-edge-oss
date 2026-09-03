import { isImageGenerationAvailable } from "./media_capabilities";

export type MediaGenerationKind = "image" | "music" | "speech" | "video";

export interface GenerationCapabilities {
  image: boolean;
  music: boolean;
  speech: boolean;
  video: boolean;
}

interface GenerationCapabilitySource {
  modelId?: string;
  supportsImages?: boolean;
  supportsVideo?: boolean;
  hasZdrEndpoint?: boolean;
  architecture?: { modality?: string };
  imageCapabilities?: { isAvailable?: boolean };
}

const MUSIC_MODEL_PREFIXES = ["google/lyria-"] as const;

function outputModalities(modality: string | undefined): Set<string> {
  const output = modality?.split("->", 2)[1] ?? "";
  return new Set(output.split("+").map((value) => value.trim()).filter(Boolean));
}

export function projectGenerationCapabilities(
  model: GenerationCapabilitySource,
): GenerationCapabilities {
  const outputs = outputModalities(model.architecture?.modality);
  const modelId = model.modelId ?? "";
  const music = outputs.has("audio") && MUSIC_MODEL_PREFIXES.some(
    (prefix) => modelId.startsWith(prefix),
  );
  return {
    image: isImageGenerationAvailable(model),
    music,
    // Dedicated TTS models advertise `speech`. Conversational models that
    // stream `audio` use the chat-completions audio contract instead and must
    // not appear in the default speech-model picker.
    speech: outputs.has("speech"),
    video: model.supportsVideo === true,
  };
}

export function supportsMediaGenerationKind(
  model: GenerationCapabilitySource,
  kind: MediaGenerationKind,
): boolean {
  return projectGenerationCapabilities(model)[kind];
}

/** ZDR support is endpoint-specific, so capability and catalogue policy must agree. */
export function projectGenerationZdrCapabilities(
  model: GenerationCapabilitySource,
): GenerationCapabilities {
  const capabilities = projectGenerationCapabilities(model);
  const hasZdrEndpoint = model.hasZdrEndpoint === true;
  return {
    // The dedicated Images API does not expose an enforceable ZDR contract.
    image: false,
    music: capabilities.music && hasZdrEndpoint,
    // The dedicated Speech API accepts provider options, but does not expose
    // the chat-completions `provider.zdr` routing guarantee.
    speech: false,
    // OpenRouter's asynchronous video API is explicitly not ZDR eligible.
    video: false,
  };
}
