import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { releaseRuntimeSession } from "../execution/bindings";
import { terminalizeExecutionComponentsForRun } from "../execution/component_refs";
import {
  appendExecutionEvent,
  heartbeatExecution,
  terminalizeExecution,
} from "../execution/control_plane";
import { runEventType } from "../execution/validators";
import { authenticateOnlineRuntimeHost } from "./host_session_auth";
import { runtimeHostError } from "./security";

const credentialArgs = {
  deviceId: v.string(),
  credentialId: v.string(),
  credential: v.string(),
  presenceSessionId: v.string(),
};

export const heartbeatAttempt = mutation({
  args: {
    ...credentialArgs,
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const host = await authenticateOnlineRuntimeHost(ctx, args, now);
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt || attempt.deviceId !== host.device.deviceId) {
      throw runtimeHostError("RUNTIME_ROUTE_MISMATCH", "Execution is assigned to another Runtime Host");
    }
    const leaseExpiresAt = await heartbeatExecution(ctx, {
      attemptId: attempt._id,
      fence: args.fence,
      claimantId: host.claimantId,
      now,
      allowCancelling: true,
    });
    await ctx.db.patch(host.credential._id, { lastUsedAt: now });
    return leaseExpiresAt;
  },
});

export const publishEvent = mutation({
  args: {
    ...credentialArgs,
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    eventId: v.string(),
    type: runEventType,
    summary: v.string(),
    phase: v.optional(v.string()),
    progress: v.optional(v.number()),
    artifactIds: v.optional(v.array(v.string())),
    privacyClass: v.optional(v.string()),
    adapterDetail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const host = await authenticateOnlineRuntimeHost(ctx, args, now);
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt || attempt.deviceId !== host.device.deviceId) {
      throw runtimeHostError("RUNTIME_ROUTE_MISMATCH", "Execution is assigned to another Runtime Host");
    }
    await appendExecutionEvent(ctx, {
      attemptId: attempt._id,
      fence: args.fence,
      claimantId: host.claimantId,
      eventId: args.eventId,
      type: args.type,
      summary: args.summary,
      phase: args.phase,
      progress: args.progress,
      artifactIds: args.artifactIds,
      privacyClass: args.privacyClass,
      adapterDetail: args.adapterDetail,
      now,
    });
    await ctx.db.patch(host.credential._id, { lastUsedAt: now });
    return null;
  },
});

export const settleAttempt = mutation({
  args: {
    ...credentialArgs,
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    outcome: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
      v.literal("interrupted"),
    ),
    summary: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const host = await authenticateOnlineRuntimeHost(ctx, args, now);
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt || attempt.deviceId !== host.device.deviceId) {
      throw runtimeHostError("RUNTIME_ROUTE_MISMATCH", "Execution is assigned to another Runtime Host");
    }
    const run = await ctx.db.get(attempt.runId);
    if (run?.domainType === "local_helper" && run.state !== "cancelling") {
      const helper = await ctx.db.query("runtimeHelperTasks")
        .withIndex("by_run", q => q.eq("runId", run._id)).unique();
      // The worker is done; Workflow still owns parsing and fenced product writes.
      if (helper?.attemptId === attempt._id && helper.fence === args.fence
        && (helper.status === "ready" || helper.status === "failed")) return null;
    }
    const bindings = await ctx.db.query("runtimeSessionBindings")
      .withIndex("by_attempt_status", (queryBuilder) =>
        queryBuilder.eq("attemptId", attempt._id).eq("status", "active"),
      )
      .collect();
    for (const binding of bindings) {
      await releaseRuntimeSession(ctx, {
        bindingId: binding._id,
        attemptId: attempt._id,
        fence: args.fence,
        status: args.outcome === "cancelled" ? "revoked" : "released",
        reason: `runtime_${args.outcome}`,
        now,
      });
    }
    await terminalizeExecutionComponentsForRun(ctx, {
      runId: attempt.runId,
      status: args.outcome === "completed" ? "completed"
        : args.outcome === "cancelled" ? "cancelled" : "failed",
      now,
    });
    await terminalizeExecution(ctx, {
      attemptId: attempt._id,
      fence: args.fence,
      claimantId: host.claimantId,
      outcome: args.outcome,
      summary: args.summary,
      allowWaiting: true,
      now,
    });
    await ctx.db.patch(host.credential._id, { lastUsedAt: now });
    return null;
  },
});
