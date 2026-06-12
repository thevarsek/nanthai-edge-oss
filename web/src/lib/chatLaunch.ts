import type { Id } from "@convex/_generated/dataModel";
import { captureAnalytics } from "@/lib/analytics";

export interface PersonaLike {
  _id: Id<"personas">;
  modelId?: string | null;
  displayName?: string | null;
  avatarEmoji?: string | null;
  avatarImageUrl?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  includeReasoning?: boolean | null;
  reasoningEffort?: string | null;
}

export interface FavoriteLike {
  _id: Id<"favorites">;
  modelIds: string[];
  participants?: Array<{
    modelId: string;
    personaId?: Id<"personas"> | string | null;
    personaName?: string | null;
    personaEmoji?: string | null;
    personaAvatarImageUrl?: string | null;
    temperature?: number | null;
    maxTokens?: number | null;
    includeReasoning?: boolean | null;
    reasoningEffort?: string | null;
  }> | null;
  personaId?: Id<"personas"> | null;
  personaName?: string | null;
  personaEmoji?: string | null;
  personaAvatarImageUrl?: string | null;
}

interface LaunchParticipant {
  modelId: string;
  personaId?: Id<"personas"> | null;
  personaName?: string | null;
  personaEmoji?: string | null;
  personaAvatarImageUrl?: string | null;
  temperature?: number;
  maxTokens?: number;
  includeReasoning?: boolean;
  reasoningEffort?: string | null;
}

export function buildDefaultParticipants(args: {
  prefs?: { defaultModelId?: string; defaultPersonaId?: string | Id<"personas"> } | null;
  personas?: PersonaLike[];
  fallbackModelId: string;
}): LaunchParticipant[] {
  const { prefs, personas, fallbackModelId } = args;
  const defaultPersonaId = prefs?.defaultPersonaId;
  const defaultPersona = defaultPersonaId
    ? (personas ?? []).find((persona) => persona._id === defaultPersonaId)
    : null;

  if (defaultPersona) {
    return [{
      modelId: defaultPersona.modelId?.trim() || prefs?.defaultModelId?.trim() || fallbackModelId,
      personaId: defaultPersona._id,
      personaName: defaultPersona.displayName ?? null,
      personaEmoji: defaultPersona.avatarEmoji ?? null,
      personaAvatarImageUrl: defaultPersona.avatarImageUrl ?? null,
      temperature: defaultPersona.temperature ?? undefined,
      maxTokens: defaultPersona.maxTokens ?? undefined,
      includeReasoning: defaultPersona.includeReasoning ?? undefined,
      reasoningEffort: defaultPersona.reasoningEffort ?? undefined,
    }];
  }

  return [{
    modelId: prefs?.defaultModelId?.trim() || fallbackModelId,
    personaId: null,
  }];
}

export function buildFavoriteParticipants(favorite: FavoriteLike): LaunchParticipant[] {
  if (favorite.participants && favorite.participants.length > 0) {
    return favorite.participants.slice(0, 3).map((participant) => ({
      modelId: participant.modelId,
      personaId: (participant.personaId as Id<"personas"> | null | undefined) ?? null,
      personaName: participant.personaName ?? null,
      personaEmoji: participant.personaEmoji ?? null,
      personaAvatarImageUrl: participant.personaAvatarImageUrl ?? null,
      temperature: participant.temperature ?? undefined,
      maxTokens: participant.maxTokens ?? undefined,
      includeReasoning: participant.includeReasoning ?? undefined,
      reasoningEffort: participant.reasoningEffort ?? undefined,
    }));
  }

  if (favorite.personaId) {
    return [{
      modelId: favorite.modelIds[0] ?? "",
      personaId: favorite.personaId,
      personaName: favorite.personaName ?? null,
      personaEmoji: favorite.personaEmoji ?? null,
      personaAvatarImageUrl: favorite.personaAvatarImageUrl ?? null,
    }];
  }

  return favorite.modelIds.slice(0, 3).map((modelId) => ({
    modelId,
    personaId: null,
  }));
}

export function buildPersonaParticipants(persona: PersonaLike, fallbackModelId: string): LaunchParticipant[] {
  return [{
    modelId: persona.modelId?.trim() || fallbackModelId,
    personaId: persona._id,
    personaName: persona.displayName ?? null,
    personaEmoji: persona.avatarEmoji ?? null,
    personaAvatarImageUrl: persona.avatarImageUrl ?? null,
    temperature: persona.temperature ?? undefined,
    maxTokens: persona.maxTokens ?? undefined,
    includeReasoning: persona.includeReasoning ?? undefined,
    reasoningEffort: persona.reasoningEffort ?? undefined,
  }];
}

export async function launchChat(args: {
  createChat: (args: {
    mode: "chat";
    folderId?: string;
    participants: LaunchParticipant[];
  }) => Promise<Id<"chats">>;
  participants: LaunchParticipant[];
  folderId?: string;
}) {
  const chatId = await args.createChat({
    mode: "chat",
    ...(args.folderId ? { folderId: args.folderId } : {}),
    participants: args.participants,
  });
  captureAnalytics("chat_created", {
    feature_area: "chat",
    chat_id: String(chatId),
    source: "launcher",
    participant_count: args.participants.length,
    model_ids: args.participants.map((participant) => participant.modelId).join(","),
    has_folder: args.folderId !== undefined,
  });
  return chatId;
}
