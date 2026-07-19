"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { resolveOwnedStorageFile } from "../runtime/storage";
import type { ToolExecutionContext } from "../tools/registry";

export const hydrate = internalAction({
  args: {
    analyticsRunId: v.id("analyticsWorkflowRuns"),
    claimantId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.analytics_workflows.mutations.setPhase, {
      analyticsRunId: args.analyticsRunId,
      claimantId: args.claimantId,
      phase: "hydrate",
    });
    const run = await ctx.runQuery(internal.analytics_workflows.queries.getRun, {
      analyticsRunId: args.analyticsRunId,
    });
    if (!run || run.status !== "running") return null;
    const toolCtx: ToolExecutionContext = {
      ctx,
      userId: run.userId,
      chatId: String(run.chatId),
      messageId: String(run.messageId),
      userMessageId: String(run.userMessageId),
      jobId: String(run.jobId),
      executionAttemptId: run.executionAttemptId,
      executionFence: run.executionFence,
    };
    for (const input of run.inputFiles) {
      await resolveOwnedStorageFile(toolCtx, input.storageId);
    }
    return null;
  },
});
