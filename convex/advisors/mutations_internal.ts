import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { usageObject } from "../schema_validators";
import { ADVISOR_RUN_LEASE_MS, MAX_ADVISOR_PARTIAL_CHARS } from "./constants";
import {
  finalizeAdvisorRun,
  scheduleAdvisorFailureAnalytics,
} from "./lifecycle";
import { isTerminalAdvisorRun } from "./shared";
import { advisorExecutionRef } from "./execution_lifecycle";
import { terminalizeDomainExecution } from "../execution/domain_lifecycle";
import { assertCurrentExecution } from "../execution/attempts";

async function authorizeAdvisorWriter(
  ctx: MutationCtx,
  run: Doc<"advisorRuns">,
  leaseOwner: string,
): Promise<boolean> {
  if (run.leaseOwner !== leaseOwner) return false;
  if (typeof run.leaseExpiresAt !== "number" || run.leaseExpiresAt <= Date.now()) return false;
  const batch = await ctx.db.get(run.batchId);
  const execution = batch ? advisorExecutionRef(batch) : null;
  if (!execution) {
    return Boolean(batch && !batch.workflowId);
  }
  try {
    await assertCurrentExecution(ctx, {
      attemptId: execution.attemptId,
      fence: execution.fence,
    });
  } catch {
    return false;
  }
  return true;
}

export const claimRun = internalMutation({
  args: { runId: v.id("advisorRuns"), leaseOwner: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || isTerminalAdvisorRun(run.status)) return false;
    const now = Date.now();
    if (run.leaseExpiresAt != null && run.leaseExpiresAt > now && run.leaseOwner !== args.leaseOwner) {
      return false;
    }
    await ctx.db.patch(run._id, {
      status: "preparing_context",
      stage: "preparing_context",
      leaseOwner: args.leaseOwner,
      leaseExpiresAt: now + ADVISOR_RUN_LEASE_MS,
      startedAt: run.startedAt ?? now,
      lastActivityAt: now,
      updatedAt: now,
    });
    const batch = await ctx.db.get(run.batchId);
    if (batch && batch.status === "queued") {
      await ctx.db.patch(batch._id, { status: "running", updatedAt: now });
    }
    return true;
  },
});

export const updateRunStreaming = internalMutation({
  args: { runId: v.id("advisorRuns"), leaseOwner: v.string(), partialAdvice: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || isTerminalAdvisorRun(run.status)
      || !await authorizeAdvisorWriter(ctx, run, args.leaseOwner)) return false;
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "streaming",
      stage: "streaming",
      partialAdvice: args.partialAdvice.slice(0, MAX_ADVISOR_PARTIAL_CHARS),
      leaseExpiresAt: now + ADVISOR_RUN_LEASE_MS,
      lastActivityAt: now,
      updatedAt: now,
    });
    return true;
  },
});

export const markRunConsulting = internalMutation({
  args: { runId: v.id("advisorRuns"), leaseOwner: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || isTerminalAdvisorRun(run.status)
      || !await authorizeAdvisorWriter(ctx, run, args.leaseOwner)) return false;
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "consulting",
      stage: "consulting",
      leaseExpiresAt: now + ADVISOR_RUN_LEASE_MS,
      lastActivityAt: now,
      updatedAt: now,
    });
    return true;
  },
});

export const finalizeRun = internalMutation({
  args: {
    runId: v.id("advisorRuns"),
    leaseOwner: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed"), v.literal("timedOut"), v.literal("cancelled")),
    advice: v.optional(v.string()),
    actualModelId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    responseId: v.optional(v.string()),
    outputItemId: v.optional(v.string()),
    replayItems: v.optional(v.array(v.any())),
    usage: v.optional(usageObject),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || !await authorizeAdvisorWriter(ctx, run, args.leaseOwner)) {
      return { changed: false, batchId: run?.batchId, allTerminal: false };
    }
    const { leaseOwner: _leaseOwner, ...finalization } = args;
    return await finalizeAdvisorRun(ctx, finalization);
  },
});

export const timeoutRun = internalMutation({
  args: { runId: v.id("advisorRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || isTerminalAdvisorRun(run.status)) return { changed: false };
    const finalization = await finalizeAdvisorRun(ctx, {
      runId: args.runId,
      status: "timedOut",
      errorCode: "ADVISOR_TIMEOUT",
      errorMessage: "Advisor consultation timed out. The main response continued without it.",
    });
    if (finalization.changed) {
      await scheduleAdvisorFailureAnalytics(ctx, run, "timedOut", "ADVISOR_TIMEOUT");
    }
    return finalization;
  },
});

export async function completeBatchForMessageHandler(
  ctx: MutationCtx,
  args: { messageId: Id<"messages"> },
): Promise<boolean> {
    const message = await ctx.db.get(args.messageId);
    if (!message?.advisorBatchId) return false;
    const batch = await ctx.db.get(message.advisorBatchId);
    if (!batch || batch.status !== "synthesizing") return false;
    const siblingMessages = await Promise.all(
      batch.assistantMessageIds.map((messageId) => ctx.db.get(messageId)),
    );
    const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
    if (
      siblingMessages.some((sibling) =>
        sibling == null || !terminalStatuses.has(sibling.status)
      )
    ) {
      return false;
    }
    await ctx.db.patch(batch._id, {
      status: batch.completedRunCount > 0 ? "completed" : "failed",
      updatedAt: Date.now(),
    });
    const execution = advisorExecutionRef(batch);
    if (execution) {
      const succeeded = siblingMessages.some(
        (sibling) => sibling?.status === "completed",
      );
      await terminalizeDomainExecution(
        ctx,
        execution,
        succeeded ? "completed" : "failed",
        succeeded
          ? "Advisor consultations and synthesis completed"
          : "Advisor synthesis did not produce a completed response",
      );
    }
    return true;
}

export const completeBatchForMessage = internalMutation({
  args: { messageId: v.id("messages") },
  returns: v.boolean(),
  handler: completeBatchForMessageHandler,
});
