import { useEffect, useMemo, useRef, useState } from "react";
import type { Participant } from "@/hooks/useChat";
import type { ParticipantEntry } from "@/hooks/useParticipants";
import { Defaults } from "@/lib/constants";
import {
  DEFAULT_PARAMETER_OVERRIDES,
  buildBaseParticipants,
  findDefaultPersona,
  resolveParticipants,
  type ParameterDefaults,
  type ParameterOverrides,
  type SharedModelSettings,
  type SharedPersona,
  type SharedPreferences,
} from "@/lib/chatRequestResolution";

interface ModelSummary {
  modelId: string;
  supportsTools?: boolean;
  supportsVideo?: boolean;
  supportedFrameImages?: unknown[] | null;
  hasZdrEndpoint?: boolean;
  provider?: string | null;
}

interface ChatParticipantsConfigSnapshotArgs {
  convexParticipants: ParticipantEntry[];
  personas: SharedPersona[] | undefined;
  prefs: SharedPreferences | undefined;
  modelSettings: SharedModelSettings[] | undefined;
  modelSummaries: ModelSummary[] | undefined;
  selectedModelId: string;
  parameterOverrides: ParameterOverrides;
}

interface ChatParticipantsConfigSnapshot {
  defaultPersona: SharedPersona | null;
  effectiveDefaultModelId: string;
  baseParticipants: ReturnType<typeof buildBaseParticipants>;
  participants: Participant[];
  paramDefaults: ParameterDefaults & { maxTokens: number | undefined };
  allParticipantsSupportTools: boolean;
  isVideoMode: boolean;
  supportsFrameImages: boolean;
  googleIntegrationsBlocked: boolean;
  isMultiModel: boolean;
}

const GOOGLE_ALLOWED_PROVIDERS = new Set(["openai", "anthropic", "google"]);

export function chatParticipantsConfigSnapshot({
  convexParticipants,
  personas,
  prefs,
  modelSettings,
  modelSummaries,
  selectedModelId,
  parameterOverrides,
}: ChatParticipantsConfigSnapshotArgs): ChatParticipantsConfigSnapshot {
  const defaultModelId = prefs?.defaultModelId ?? Defaults.model;
  const defaultPersona = findDefaultPersona(personas, prefs);
  const effectiveDefaultModelId = defaultPersona?.modelId ?? defaultModelId;
  const baseParticipants = buildBaseParticipants({
    convexParticipants,
    defaultPersona,
    selectedModelId,
  });
  const participants = resolveParticipants({
    baseParticipants,
    personas,
    prefs,
    modelSettings,
    overrides: parameterOverrides,
  });
  const firstDefaultParticipant = resolveParticipants({
    baseParticipants: baseParticipants.slice(0, 1),
    personas,
    prefs,
    modelSettings,
    overrides: DEFAULT_PARAMETER_OVERRIDES,
  })[0];

  return {
    defaultPersona,
    effectiveDefaultModelId,
    baseParticipants,
    participants,
    paramDefaults: {
      temperature: firstDefaultParticipant?.temperature ?? Defaults.temperature,
      maxTokens: firstDefaultParticipant?.maxTokens,
      includeReasoning: firstDefaultParticipant?.includeReasoning ?? true,
      reasoningEffort: firstDefaultParticipant?.reasoningEffort ?? "medium",
      autoAudioResponse: prefs?.autoAudioResponse ?? false,
    },
    allParticipantsSupportTools: participantsSupportTools(participants, modelSummaries),
    isVideoMode: participantsUseVideo(participants, modelSummaries),
    supportsFrameImages: participantsSupportFrameImages(participants, modelSummaries),
    googleIntegrationsBlocked: googleIntegrationsBlockedForParticipants(participants, modelSummaries),
    isMultiModel: participants.length > 1,
  };
}

export function participantsSupportTools(
  participants: Participant[],
  modelSummaries: ModelSummary[] | undefined,
): boolean {
  if (!modelSummaries) return true;
  return participants.every((participant) => {
    const summary = modelSummaries.find((item) => item.modelId === participant.modelId);
    return summary?.supportsTools ?? true;
  });
}

export function participantsUseVideo(
  participants: Participant[],
  modelSummaries: ModelSummary[] | undefined,
): boolean {
  if (!modelSummaries) return false;
  return participants.some((participant) => {
    const summary = modelSummaries.find((item) => item.modelId === participant.modelId);
    return summary?.supportsVideo === true;
  });
}

export function participantsSupportFrameImages(
  participants: Participant[],
  modelSummaries: ModelSummary[] | undefined,
): boolean {
  if (!participantsUseVideo(participants, modelSummaries) || !modelSummaries) return false;
  return participants.some((participant) => {
    const summary = modelSummaries.find((item) => item.modelId === participant.modelId);
    return summary?.supportsVideo === true && (summary.supportedFrameImages?.length ?? 0) > 0;
  });
}

export function googleIntegrationsBlockedForParticipants(
  participants: Participant[],
  modelSummaries: ModelSummary[] | undefined,
): boolean {
  if (!modelSummaries) return false;
  return participants.some((participant) => {
    const summary = modelSummaries.find((item) => item.modelId === participant.modelId);
    if (!summary) return false;
    return !summary.hasZdrEndpoint || !GOOGLE_ALLOWED_PROVIDERS.has((summary.provider ?? "").toLowerCase());
  });
}

export function useChatParticipantsConfig({
  convexParticipants,
  personas,
  prefs,
  modelSettings,
  modelSummaries,
  parameterOverrides,
}: Omit<ChatParticipantsConfigSnapshotArgs, "selectedModelId">) {
  const defaultModelId = prefs?.defaultModelId ?? Defaults.model;
  const defaultPersona = useMemo(
    () => findDefaultPersona(personas, prefs),
    [personas, prefs],
  );
  const effectiveDefaultModelId = defaultPersona?.modelId ?? defaultModelId;
  const [selectedModelId, setSelectedModelId] = useState(effectiveDefaultModelId);

  useEffect(() => {
    if (convexParticipants.length === 0) return;
    const timer = window.setTimeout(() => setSelectedModelId(convexParticipants[0].modelId), 0);
    return () => window.clearTimeout(timer);
  }, [convexParticipants]);

  const resolvedDefaultRef = useRef(effectiveDefaultModelId);
  useEffect(() => {
    if (effectiveDefaultModelId !== resolvedDefaultRef.current && convexParticipants.length === 0) {
      const timer = window.setTimeout(() => {
        setSelectedModelId(effectiveDefaultModelId);
        resolvedDefaultRef.current = effectiveDefaultModelId;
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [effectiveDefaultModelId, convexParticipants.length]);

  return useMemo(
    () => chatParticipantsConfigSnapshot({
      convexParticipants,
      personas,
      prefs,
      modelSettings,
      modelSummaries,
      selectedModelId,
      parameterOverrides,
    }),
    [convexParticipants, personas, prefs, modelSettings, modelSummaries, selectedModelId, parameterOverrides],
  );
}
