import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { authenticateOnlineRuntimeHost } from "./host_session_auth";
import { assertCurrentExecution } from "../execution/attempts";
import { proposeWorkResultHandler } from "../collaboration/work_reviews";

export const publish = internalMutation({
  args: {
    deviceId: v.string(), credentialId: v.string(), credential: v.string(), presenceSessionId: v.string(),
    attemptId: v.id("executionAttempts"), fence: v.number(), callId: v.string(),
    workId: v.id("collaborationWork"), action: v.union(v.literal("publish"), v.literal("block"), v.literal("accept"), v.literal("rework")),
    description: v.string(), sourceRevision: v.string(), requirementRevision: v.number(), evidenceRevision: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const host = await authenticateOnlineRuntimeHost(ctx, args);
    const { run } = await assertCurrentExecution(ctx, { ...args, claimantId: host.claimantId });
    if (!run.generationJobId || run.userId !== host.device.userId) throw new Error("WORK_EXECUTION_NOT_OWNED");
    return await proposeWorkResultHandler(ctx, {
      userId: run.userId, workId: args.workId, jobId: run.generationJobId,
      attemptId: args.attemptId, fence: args.fence,
      action: args.action, description: args.description, sourceRevision: args.sourceRevision,
      requirementRevision: args.requirementRevision, evidenceRevision: args.evidenceRevision,
      operationKey: `runtime-work:${String(args.attemptId)}:${args.callId}`,
    });
  },
});
