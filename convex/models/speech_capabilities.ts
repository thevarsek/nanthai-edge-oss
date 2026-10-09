import { v } from "convex/values";

export const speechEndpointCapabilitiesValidator = v.object({
  endpoints: v.array(v.object({
    providerTag: v.string(),
    supportsVoiceCloning: v.boolean(),
    supportsMultipleAudioReferences: v.boolean(),
    supportsZdr: v.boolean(),
  })),
  syncedAt: v.number(),
});

export interface SpeechEndpoint {
  tag?: string;
  supports_voice_cloning?: boolean;
  supports_multiple_audio_references?: boolean;
}

export interface SpeechEndpointCapabilities {
  endpoints: Array<{
    providerTag: string;
    supportsVoiceCloning: boolean;
    supportsMultipleAudioReferences: boolean;
    supportsZdr: boolean;
  }>;
  syncedAt: number;
}

export function prepareSpeechEndpoints(
  endpoints: SpeechEndpoint[],
  zdrTags: Set<string>,
  syncedAt: number,
): SpeechEndpointCapabilities {
  return {
    endpoints: endpoints.flatMap((endpoint) => typeof endpoint.tag === "string" ? [{
      providerTag: endpoint.tag,
      supportsVoiceCloning: endpoint.supports_voice_cloning === true,
      supportsMultipleAudioReferences: endpoint.supports_multiple_audio_references === true,
      supportsZdr: zdrTags.has(endpoint.tag),
    }] : []),
    syncedAt,
  };
}

export function projectVoiceCloningCapabilities(capabilities?: SpeechEndpointCapabilities) {
  const cloning = capabilities?.endpoints.filter((endpoint) => endpoint.supportsVoiceCloning) ?? [];
  const maximum = (endpoints: typeof cloning) => endpoints.length === 0 ? 0
    : endpoints.some((endpoint) => endpoint.supportsMultipleAudioReferences) ? 3 : 1;
  return {
    supportsVoiceCloning: cloning.length > 0,
    maxAudioReferences: maximum(cloning),
    maxZdrAudioReferences: maximum(cloning.filter((endpoint) => endpoint.supportsZdr)),
    maxReferenceBytes: 15 * 1024 * 1024,
    maxTranscriptCharacters: 10_000,
  };
}
