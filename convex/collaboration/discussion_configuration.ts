import { internalQuery } from "../_generated/server";
import { runCycleArgs } from "../autonomous/actions_args";

export const resolveCurrent = internalQuery({
  args: runCycleArgs,
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== args.userId) throw new Error("DISCUSSION_SESSION_UNAVAILABLE");
    const participantConfigs = await Promise.all(args.participantConfigs.map(async config => {
      const participantId = ctx.db.normalizeId("chatParticipants", config.participantId);
      const participant = participantId ? await ctx.db.get(participantId) : null;
      if (!participant || participant.chatId !== session.chatId || participant.userId !== session.userId) {
        throw new Error("DISCUSSION_PARTICIPANT_UNAVAILABLE");
      }
      const persona = participant.personaId ? await ctx.db.get(participant.personaId) : null;
      if (participant.personaId && (!persona || persona.userId !== session.userId)) throw new Error("DISCUSSION_PERSONA_UNAVAILABLE");
      return { ...config, personaId: participant.personaId, modelId: persona?.modelId ?? participant.modelId,
        displayName: persona?.displayName ?? participant.personaName ?? config.displayName,
        systemPrompt: persona?.systemPrompt, temperature: persona?.temperature ?? participant.temperature,
        maxTokens: persona?.maxTokens ?? participant.maxTokens,
        includeReasoning: persona?.includeReasoning ?? participant.includeReasoning,
        reasoningEffort: persona?.reasoningEffort ?? participant.reasoningEffort };
    }));
    const moderator = args.moderatorConfig?.personaId ? await ctx.db.get(args.moderatorConfig.personaId) : null;
    const moderatorConfig = moderator && moderator.userId === args.userId
      ? { modelId: moderator.modelId ?? args.moderatorConfig!.modelId, personaId: moderator._id, displayName: moderator.displayName }
      : args.moderatorConfig;
    return { participantConfigs, moderatorConfig };
  },
});
