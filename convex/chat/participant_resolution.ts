import { personaSystemPrompt } from "../personas/default_prompt";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { SendParticipantConfig } from "./mutation_send_helpers";

export async function resolveChatParticipantConfigs(
  ctx: MutationCtx,
  args: {
    chatId: Id<"chats">;
    userId: string;
    participants: SendParticipantConfig[];
    allowPersonaOverride?: boolean;
  },
): Promise<SendParticipantConfig[]> {
  if (!args.participants.some((participant) => participant.participantKey || participant.personaId)) {
    return args.participants;
  }
  const chatParticipants = await ctx.db
    .query("chatParticipants")
    .withIndex("by_chat", (query) => query.eq("chatId", args.chatId))
    .collect();
  const participantsById = new Map(
    chatParticipants
      .filter((participant) => participant.userId === args.userId)
      .map((participant) => [String(participant._id), participant]),
  );
  return await Promise.all(args.participants.map(async (requested) => {
    const matchingPersona = requested.personaId ? chatParticipants.filter(participant => participant.userId === args.userId && participant.personaId === requested.personaId) : [];
    const canonical = requested.participantKey ? participantsById.get(requested.participantKey) : matchingPersona.length === 1 ? matchingPersona[0] : undefined;
    if (requested.participantKey && !canonical) {
      throw new ConvexError({
        code: "VALIDATION",
        message: "A chat participant is no longer available. Refresh the chat and try again.",
      });
    }
    const personaId = args.allowPersonaOverride && "personaId" in requested
      ? requested.personaId : canonical ? canonical.personaId : requested.personaId;
    if (personaId) {
      const persona = await ctx.db.get(personaId);
      if (!persona || persona.userId !== args.userId) {
        throw new ConvexError({ code: "PERSONA_UNAVAILABLE", message: "This Persona is no longer available. Choose an available Persona before starting another turn." });
      }
      return {
        ...requested, participantKey: canonical ? String(canonical._id) : requested.participantKey,
        personaId: persona._id, personaName: persona.displayName, personaEmoji: persona.avatarEmoji,
        personaAvatarImageUrl: persona.avatarImageStorageId
          ? await ctx.storage.getUrl(persona.avatarImageStorageId) : undefined,
        systemPrompt: personaSystemPrompt(persona.systemPrompt), modelId: persona.modelId ?? canonical?.modelId ?? requested.modelId,
        temperature: persona.temperature, maxTokens: persona.maxTokens,
        includeReasoning: persona.includeReasoning, reasoningEffort: persona.reasoningEffort,
      };
    }
    if (!canonical || args.allowPersonaOverride) return requested;
    return {
      ...requested,
      participantKey: String(canonical._id),
      modelId: canonical.modelId,
      personaId: canonical.personaId,
      personaName: canonical.personaName,
      personaEmoji: canonical.personaEmoji,
      personaAvatarImageUrl: canonical.personaAvatarImageUrl,
      temperature: canonical.temperature,
      maxTokens: canonical.maxTokens,
      includeReasoning: canonical.includeReasoning,
      reasoningEffort: canonical.reasoningEffort,
    };
  }));
}
