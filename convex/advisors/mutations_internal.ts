import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { usageObject } from "../schema_validators";
import { ADVISOR_RUN_LEASE_MS, MAX_ADVISOR_PARTIAL_CHARS } from "./constants";
import {
  finalizeAdvisorRun,
  scheduleAdvisorFailureAnalytics,
} from "./lifecycle";
import { isTerminalAdvisorRun } from "./shared";

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
  args: { runId: v.id("advisorRuns"), partialAdvice: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || isTerminalAdvisorRun(run.status)) return false;
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "streaming",
      stage: "streaming",
      partialAdvice: args.partialAdvice.slice(0, MAX_ADVISOR_PARTIAL_CHARS),
      lastActivityAt: now,
      updatedAt: now,
    });
    return true;
  },
});

export const markRunConsulting = internalMutation({
  args: { runId: v.id("advisorRuns") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || isTerminalAdvisorRun(run.status)) return false;
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "consulting",
      stage: "consulting",
      lastActivityAt: now,
      updatedAt: now,
    });
    return true;
  },
});

export const finalizeRun = internalMutation({
  args: {
    runId: v.id("advisorRuns"),
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
  handler: finalizeAdvisorRun,
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

export const completeBatchForMessage = internalMutation({
  args: { messageId: v.id("messages") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
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
    return true;
  },
});
