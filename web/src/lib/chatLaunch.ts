import type { Id } from "@convex/_generated/dataModel";

export interface PersonaLike {
  _id: Id<"personas">;
  modelId?: string | null;
  displayName?: string | null;
  avatarEmoji?: string | null;
  avatarImageUrl?: string | null;
}

export interface FavoriteLike {
  _id: Id<"favorites">;
  modelIds: string[];
  personaId?: Id<"personas"> | null;
  personaName?: string | null;
  personaEmoji?: string | null;
  personaAvatarImageUrl?: string | null;
}

export function buildDefaultParticipants(args: {
  prefs?: { defaultModelId?: string; defaultPersonaId?: string | Id<"personas"> } | null;
  personas?: PersonaLike[];
  fallbackModelId: string;
}) {
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
    }];
  }

  return [{
    modelId: prefs?.defaultModelId?.trim() || fallbackModelId,
    personaId: null,
  }];
}

export function buildFavoriteParticipants(favorite: FavoriteLike) {
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

export function buildPersonaParticipants(persona: PersonaLike, fallbackModelId: string) {
  return [{
    modelId: persona.modelId?.trim() || fallbackModelId,
    personaId: persona._id,
    personaName: persona.displayName ?? null,
    personaEmoji: persona.avatarEmoji ?? null,
    personaAvatarImageUrl: persona.avatarImageUrl ?? null,
  }];
}

export async function launchChat(args: {
  createChat: (args: {
    mode: "chat";
    folderId?: string;
    participants: Array<{
      modelId: string;
      personaId?: Id<"personas"> | null;
      personaName?: string | null;
      personaEmoji?: string | null;
      personaAvatarImageUrl?: string | null;
    }>;
  }) => Promise<Id<"chats">>;
  participants: Array<{
    modelId: string;
    personaId?: Id<"personas"> | null;
    personaName?: string | null;
    personaEmoji?: string | null;
    personaAvatarImageUrl?: string | null;
  }>;
  folderId?: string;
}) {
  return await args.createChat({
    mode: "chat",
    ...(args.folderId ? { folderId: args.folderId } : {}),
    participants: args.participants,
  });
}
