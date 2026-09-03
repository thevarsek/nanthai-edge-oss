import { internalQuery, query, type QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { projectExecution } from "./projection";

const executionProjection = v.object({
  runId: v.string(),
  attemptId: v.optional(v.string()),
  attemptNumber: v.optional(v.number()),
  fence: v.optional(v.number()),
  kind: v.string(),
  domainType: v.optional(v.string()),
  domainId: v.optional(v.string()),
  parentRunId: v.optional(v.string()),
  state: v.string(),
  placement: v.union(v.literal("cloud"), v.literal("local")),
  executorKind: v.optional(v.string()),
  runtimeLabel: v.optional(v.string()),
  provider: v.optional(v.string()),
  modelId: v.optional(v.string()),
  phase: v.optional(v.string()),
  progress: v.optional(v.number()),
  checkpointRef: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  lastEventSequence: v.optional(v.number()),
  lastEventType: v.optional(v.string()),
  artifactIds: v.optional(v.array(v.string())),
  lastEventSummary: v.optional(v.string()),
  updatedAt: v.number(),
  cancelAvailable: v.boolean(),
  cancelRequested: v.boolean(),
  needsInput: v.boolean(),
  needsPermission: v.boolean(),
  terminalOutcome: v.optional(v.string()),
  terminalSummary: v.optional(v.string()),
});

export const getComponentRefInternal = internalQuery({
  args: { componentRefId: v.id("executionComponentRefs") },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => await ctx.db.get(args.componentRefId),
});

const isCancellationRequestedArgs = {
  attemptId: v.id("executionAttempts"),
  fence: v.number(),
};

export async function isCancellationRequestedHandler(
  ctx: QueryCtx,
  args: { attemptId: Id<"executionAttempts">; fence: number },
): Promise<boolean> {
  const attempt = await ctx.db.get(args.attemptId);
  if (!attempt || attempt.fence !== args.fence) return true;
  const run = await ctx.db.get(attempt.runId);
  if (
    !run
    || run.activeAttemptId !== attempt._id
    || ["cancelling", "completed", "failed", "cancelled"].includes(run.state)
  ) return true;
  const tombstone = await ctx.db
    .query("accountDeletionTombstones")
    .withIndex("by_user", (query) => query.eq("userId", run.userId))
    .unique();
  if (tombstone) return true;
  if (!run.chatId) return false;
  const chat = await ctx.db.get(run.chatId);
  return !chat || chat.isDeleting === true;
}

export const isCancellationRequested = internalQuery({
  args: isCancellationRequestedArgs,
  returns: v.boolean(),
  handler: isCancellationRequestedHandler,
});

export const listActiveComponentsForUser = internalQuery({
  args: { userId: v.string() },
  returns: v.array(v.object({
    executorKind: v.union(
      v.literal("convex_action"),
      v.literal("convex_workflow"),
      v.literal("external_cloud"),
      v.literal("local_runtime"),
    ),
    operationId: v.string(),
    adapterId: v.string(),
  })),
  handler: async (ctx, args) => {
    const refs = (await Promise.all(
      (["active", "cancel_requested"] as const).map((status) =>
        ctx.db
          .query("executionComponentRefs")
          .withIndex("by_user_status", (q) => q.eq("userId", args.userId).eq("status", status))
          .collect(),
      ),
    )).flat();
    const activeStates = ["queued", "claimed", "running", "waiting", "interrupted"] as const;
    const attempts = (await Promise.all(
      activeStates.map((status) =>
        ctx.db
          .query("executionAttempts")
          .withIndex("by_user_status", (q) => q.eq("userId", args.userId).eq("status", status))
          .collect(),
      ),
    )).flat();
    const attemptBacked = attempts.flatMap((attempt) => {
      if (!attempt.componentOperationId || attempt.executorKind === "convex_action") return [];
      return [{
        executorKind: attempt.executorKind,
        operationId: attempt.componentOperationId,
        adapterId: attempt.adapterId,
      }];
    });
    const canonical = refs.map((ref) => ({
      executorKind: ref.adapterId === "convex-workflow"
        ? "convex_workflow" as const
        : ref.adapterId === "local-runtime"
          ? "local_runtime" as const
          : ref.adapterId === "external-cloud"
            ? "external_cloud" as const
            : "convex_action" as const,
      operationId: ref.operationId,
      adapterId: ref.adapterId,
    }));
    return [...canonical, ...attemptBacked].filter((component, index, all) =>
      all.findIndex((candidate) =>
        candidate.adapterId === component.adapterId
        && candidate.operationId === component.operationId,
      ) === index,
    );
  },
});

export const listMyRuns = query({
  args: { chatId: v.optional(v.id("chats")), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
    if (args.chatId) {
      return await ctx.db
        .query("executionRuns")
        .withIndex("by_user_chat", (q) => q.eq("userId", userId).eq("chatId", args.chatId))
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("executionRuns")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});

export const getRunDetailInternal = internalQuery({
  args: { runId: v.id("executionRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const [attempts, events, operations, commands, components, children] = await Promise.all([
      ctx.db.query("executionAttempts").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
      ctx.db.query("runEvents").withIndex("by_run_sequence", (q) => q.eq("runId", run._id)).collect(),
      ctx.db.query("executionOperations").withIndex("by_run_operation", (q) => q.eq("runId", run._id)).collect(),
      ctx.db.query("runtimeCommands").withIndex("by_run_command", (q) => q.eq("runId", run._id)).collect(),
      ctx.db.query("executionComponentRefs").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
      ctx.db.query("executionRuns").withIndex("by_parent", (q) => q.eq("parentRunId", run._id)).collect(),
    ]);
    const bindings = (await Promise.all(attempts.map((attempt) =>
      ctx.db.query("runtimeSessionBindings")
        .withIndex("by_attempt", (q) => q.eq("attemptId", attempt._id))
        .collect(),
    ))).flat();
    return { run, attempts, events, operations, commands, components, bindings, children };
  },
});

export const listMyRunProjections = query({
  args: { chatId: v.id("chats"), limit: v.optional(v.number()) },
  returns: v.array(executionProjection),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId || chat.isDeleting === true) return [];
    const recent = await ctx.db
      .query("executionRuns")
      .withIndex("by_user_chat", (q) => q.eq("userId", userId).eq("chatId", args.chatId))
      .order("desc")
      .take(limit);
    const activeStates = [
      "queued",
      "running",
      "waiting",
      "waiting_for_input",
      "waiting_for_permission",
      "interrupted",
      "cancelling",
    ] as const;
    const active = (await Promise.all(activeStates.map((state) => ctx.db
      .query("executionRuns")
      .withIndex("by_chat_state", (q) => q.eq("chatId", args.chatId).eq("state", state))
      .order("desc")
      .take(limit)))).flat()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, limit);
    const runs = [...active, ...recent].filter((run, index, all) =>
      all.findIndex((candidate) => candidate._id === run._id) === index,
    ).slice(0, limit);
    return await Promise.all(runs.map(async (run) => {
      const [attempt, events] = await Promise.all([
        run.activeAttemptId ? ctx.db.get(run.activeAttemptId) : null,
        ctx.db
          .query("runEvents")
          .withIndex("by_run_sequence", (q) => q.eq("runId", run._id))
          .order("desc")
          .take(1),
      ]);
      return projectExecution(run, attempt, events[0] ?? null);
    }));
  },
});
