import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { contextAssemblyMode, promotionDecision, runtimeKind } from "../schema_validators";

export const insertContextAssemblyLog = internalMutation({
  args: {
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    jobId: v.id("generationJobs"),
    visibilityScope: v.union(
      v.literal("participant"),
      v.literal("shared_participants"),
      v.literal("branch"),
      v.literal("conversation"),
      v.literal("audit_only"),
    ),
    ownerParticipantId: v.optional(v.string()),
    ownerModelRunId: v.optional(v.string()),
    runtimeKind: v.optional(runtimeKind),
    subagentBatchId: v.optional(v.id("subagentBatches")),
    subagentRunId: v.optional(v.id("subagentRuns")),
    parentMessageId: v.optional(v.id("messages")),
    parentJobId: v.optional(v.id("generationJobs")),
    parentToolCallId: v.optional(v.string()),
    promotionDecision: v.optional(promotionDecision),
    mode: contextAssemblyMode,
    legacyMessageCount: v.number(),
    assembledMessageCount: v.number(),
    legacyEstimatedTokens: v.number(),
    assembledEstimatedTokens: v.number(),
    rawArtifactCount: v.number(),
    memoryCount: v.number(),
    rehydratedArtifactCount: v.number(),
    rehydratedArtifactBytes: v.optional(v.number()),
    storageRehydrationMs: v.optional(v.number()),
    provenanceRepairMs: v.optional(v.number()),
    provenanceRepairAttempts: v.optional(v.number()),
    safetyMismatches: v.array(v.string()),
    toolSelectionDrift: v.boolean(),
    retryDivergence: v.boolean(),
    branchDivergence: v.boolean(),
    memoryInclusionDivergence: v.boolean(),
    providerRoutingDivergence: v.boolean(),
    resolvedPolicyVersion: v.optional(v.string()),
    resolvedPolicySummary: v.optional(v.string()),
    excludedReasonCounts: v.optional(v.any()),
    graphCandidateCount: v.optional(v.number()),
    graphSelectedCount: v.optional(v.number()),
    graphQueryMs: v.optional(v.number()),
    policyEvaluationMs: v.optional(v.number()),
    serializationMs: v.optional(v.number()),
    automatedJudgement: v.optional(v.any()),
    decisionSummary: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("contextAssemblyLogs", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const pruneContextAssemblyLogs = internalMutation({
  args: {
    userId: v.optional(v.string()),
    olderThan: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const query = args.userId
      ? ctx.db
        .query("contextAssemblyLogs")
        .withIndex("by_user", (q) => q.eq("userId", args.userId as string))
      : ctx.db.query("contextAssemblyLogs");
    const rows = await query.take(args.limit ?? 200);
    let deleted = 0;
    let retained = 0;
    for (const row of rows) {
      if (row.createdAt < args.olderThan) {
        await ctx.db.delete(row._id);
        deleted += 1;
      } else {
        retained += 1;
      }
    }
    return { scanned: rows.length, deleted, retained, skippedByPolicy: 0 };
  },
});
