"use node";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { runCycleArgs } from "./actions_args";
import { generateModeratorDirective } from "./actions_helpers";
import { normalizeRunCycleArgs, resolveTurnParticipants } from "./actions_run_cycle_context";
import { internal } from "../_generated/api";

export const generate = internalAction({
  args: { ...runCycleArgs, participantIndex: v.number() }, returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    const session = await ctx.runQuery(internal.autonomous.queries.getSession, { sessionId: args.sessionId });
    if (!session || session.status !== "running" || session.executionEpoch !== args.executionEpoch) return null;
    const normalized = normalizeRunCycleArgs(args);
    const participant = resolveTurnParticipants(session.turnOrder, normalized.participants)[args.participantIndex];
    if (!participant || !normalized.moderator) return null;
    return await generateModeratorDirective(ctx, normalized.moderator, participant, session.chatId, args.userId) ?? null;
  },
});
