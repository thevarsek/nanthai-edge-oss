import { v, type ObjectType } from "convex/values";
import { runGenerationArgs } from "../chat/actions_args";
import { enqueueRunGeneration } from "../chat/run_generation_queue";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../_generated/server";
import { isCurrentResearchExecution } from "./execution_lifecycle";

const commitGenerationHandoffArgs = {
    sessionId: v.id("searchSessions"),
    generationArgs: v.object(runGenerationArgs),
    progress: v.number(),
    searchCallCount: v.number(),
    perplexityModelTier: v.string(),
    participantCount: v.number(),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
};

type CommitGenerationHandoffArgs = ObjectType<
  typeof commitGenerationHandoffArgs
>;

export async function commitGenerationHandoffHandler(
  ctx: MutationCtx,
  args: CommitGenerationHandoffArgs,
  startGeneration = enqueueRunGeneration,
): Promise<string> {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("SEARCH_SESSION_NOT_FOUND");
    const hasExecutionToken = args.executionAttemptId !== undefined
      || args.executionFence !== undefined;
    if (
      hasExecutionToken
      && !await isCurrentResearchExecution(ctx, session, args)
    ) throw new Error("RESEARCH_EXECUTION_STALE");
    if (session.generationHandoffOperationId) {
      return session.generationHandoffOperationId;
    }
    const operationId = await startGeneration(ctx, args.generationArgs);
    await ctx.db.patch(session._id, {
      status: "writing",
      progress: args.progress,
      currentPhase: "writing",
      searchCallCount: args.searchCallCount,
      perplexityModelTier: args.perplexityModelTier,
      participantCount: args.participantCount,
      generationHandoffOperationId: operationId,
      generationHandoffAt: Date.now(),
    });
    return operationId;
}

export const commitGenerationHandoff = internalMutation({
  args: commitGenerationHandoffArgs,
  returns: v.string(),
  handler: commitGenerationHandoffHandler,
});

export const getGenerationHandoffByMessage = internalQuery({
  args: { assistantMessageId: v.id("messages") },
  returns: v.union(v.null(), v.object({ operationId: v.string() })),
  handler: async (ctx, args) => {
    const session = await ctx.db.query("searchSessions")
      .withIndex("by_message", (query) =>
        query.eq("assistantMessageId", args.assistantMessageId),
      )
      .first();
    return session?.generationHandoffOperationId
      ? { operationId: session.generationHandoffOperationId }
      : null;
  },
});
