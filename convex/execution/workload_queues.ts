import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { backgroundWorkpool, maintenanceWorkpool } from "./components";
import { linkExecutionComponent } from "./component_refs";
import { createExecutionRun } from "./runs";
import { claimExecutionRun } from "./attempts";
import { scheduleWorkpoolCompletionWatchdog } from
  "./workpool_watchdog_schedule";
async function createMaintenanceRun(
  ctx: MutationCtx,
  args: { userId: string; runKey: string; domainType: string; domainId: string },
) {
  const created = await createExecutionRun(ctx, {
    userId: args.userId,
    runKey: args.runKey,
    kind: "maintenance",
    requestedPlacement: "cloud",
    domainType: args.domainType,
    domainId: args.domainId,
    initialAttempt: {
      executorKind: "convex_action",
      placement: "cloud",
      adapterId: "maintenance-workpool",
      orchestrationEngine: "convex_workpool",
      orchestrationVersion: "m47.v1",
    },
  });
  return await claimExecutionRun(ctx, {
    runId: created.runId,
    claimantId: `maintenance-workpool:${String(created.runId)}`,
    leaseMs: 12 * 60 * 1_000,
  }) ?? created;
}

async function generationRunForMessage(
  ctx: MutationCtx,
  messageId: Id<"messages"> | undefined,
): Promise<Id<"executionRuns"> | undefined> {
  if (!messageId) return undefined;
  const job = await ctx.db
    .query("generationJobs")
    .withIndex("by_message", (q) => q.eq("messageId", messageId))
    .first();
  return job?.executionRunId;
}

async function linkBackgroundWork(
  ctx: MutationCtx,
  runId: Id<"executionRuns"> | undefined,
  operationId: string,
  role: string,
): Promise<void> {
  if (!runId) return;
  await linkExecutionComponent(ctx, {
    runId,
    adapterId: "background-workpool",
    operationId,
    role,
  });
  await scheduleWorkpoolCompletionWatchdog(ctx, {
    kind: "background_work",
    operationId,
    runId,
  });
}

export const enqueueMemoryEmbedding = internalMutation({
  args: { memoryId: v.id("memories"), content: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const memory = await ctx.db.get(args.memoryId);
    if (!memory) throw new Error("MEMORY_NOT_FOUND");
    const execution = await createMaintenanceRun(ctx, {
      userId: memory.userId,
      runKey: `memory-embedding:${String(memory._id)}:${memory.updatedAt}`,
      domainType: "memory_embedding",
      domainId: String(memory._id),
    });
    const existing = await ctx.db
      .query("executionComponentRefs")
      .withIndex("by_run_role", (q) => q
        .eq("runId", execution.runId)
        .eq("role", "memory-embedding"))
      .unique();
    if (existing) return existing.operationId;
    const workId = await maintenanceWorkpool.enqueueAction(
      ctx,
      internal.memory.operations.computeAndStoreEmbedding,
      args,
      {
        retry: false,
        name: "memory-embedding",
        onComplete: internal.execution.workload_queue_callbacks.reconcileMaintenanceWork,
        context: { runId: execution.runId },
      },
    );
    await linkExecutionComponent(ctx, {
      runId: execution.runId,
      attemptId: execution.attemptId,
      fence: execution.fence,
      adapterId: "maintenance-workpool",
      operationId: workId,
      role: "memory-embedding",
    });
    await scheduleWorkpoolCompletionWatchdog(ctx, {
      kind: "maintenance_work",
      operationId: workId,
      runId: execution.runId,
    });
    return workId;
  },
});

export const enqueueMemoryRelationship = internalMutation({
  args: { memoryId: v.id("memories") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const memory = await ctx.db.get(args.memoryId);
    if (!memory) throw new Error("MEMORY_NOT_FOUND");
    const execution = await createMaintenanceRun(ctx, {
      userId: memory.userId,
      runKey: `memory-relationship:${String(memory._id)}:${memory.updatedAt}`,
      domainType: "memory_relationship",
      domainId: String(memory._id),
    });
    const existing = await ctx.db
      .query("executionComponentRefs")
      .withIndex("by_run_role", (q) => q
        .eq("runId", execution.runId)
        .eq("role", "memory-relationship"))
      .unique();
    if (existing) return existing.operationId;
    const workId = await maintenanceWorkpool.enqueueAction(
      ctx,
      internal.memory.relationships.rebuildForMemory,
      args,
      {
        retry: false,
        name: "memory-relationship",
        onComplete: internal.execution.workload_queue_callbacks.reconcileMaintenanceWork,
        context: { runId: execution.runId },
      },
    );
    await linkExecutionComponent(ctx, {
      runId: execution.runId,
      attemptId: execution.attemptId,
      fence: execution.fence,
      adapterId: "maintenance-workpool",
      operationId: workId,
      role: "memory-relationship",
    });
    await scheduleWorkpoolCompletionWatchdog(ctx, {
      kind: "maintenance_work",
      operationId: workId,
      runId: execution.runId,
    });
    return workId;
  },
});

export async function enqueuePostProcessOnceHandler(
  ctx: MutationCtx,
  args: {
    chatId: Id<"chats">;
    userMessageId: Id<"messages">;
    assistantMessageIds: Id<"messages">[];
    userId: string;
  },
): Promise<string | null> {
  const messageId = args.assistantMessageIds[0];
  if (!messageId) return null;
  const message = await ctx.db.get(messageId);
  if (!message || message.postProcessScheduledAt != null) return null;
  const runId = await generationRunForMessage(ctx, messageId);
  const workId = await backgroundWorkpool.enqueueAction(
    ctx,
    internal.chat.actions.postProcess,
    args,
    {
      retry: false,
      name: "post-generation",
      onComplete: internal.execution.workload_queue_callbacks.reconcileBackgroundWork,
      context: runId ? { runId } : {},
    },
  );
  await linkBackgroundWork(ctx, runId, workId, "post-generation");
  await ctx.db.patch(messageId, { postProcessScheduledAt: Date.now() });
  return workId;
}

export const enqueuePostProcessOnce = internalMutation({
  args: {
    chatId: v.id("chats"),
    userMessageId: v.id("messages"),
    assistantMessageIds: v.array(v.id("messages")),
    userId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: enqueuePostProcessOnceHandler,
});

export const enqueueTitle = internalMutation({
  args: {
    chatId: v.id("chats"),
    sourceContent: v.string(),
    assistantContent: v.optional(v.string()),
    titleModel: v.optional(v.string()),
    userId: v.string(),
    messageId: v.optional(v.id("messages")),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const runId = await generationRunForMessage(ctx, args.messageId);
    const workId = await backgroundWorkpool.enqueueAction(
      ctx,
      internal.chat.actions.generateTitle,
      args,
      {
        retry: false,
        name: "chat-title",
        onComplete: internal.execution.workload_queue_callbacks.reconcileBackgroundWork,
        context: runId ? { runId } : {},
      },
    );
    await linkBackgroundWork(ctx, runId, workId, "chat-title");
    return workId;
  },
});

export const enqueueMemoryExtraction = internalMutation({
  args: {
    chatId: v.id("chats"),
    userMessageContent: v.string(),
    userMessageId: v.id("messages"),
    assistantMessageId: v.optional(v.id("messages")),
    assistantContent: v.string(),
    userId: v.string(),
    extractionModel: v.optional(v.string()),
    isPending: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const runId = await generationRunForMessage(
      ctx,
      args.assistantMessageId ?? args.userMessageId,
    );
    const workId = await backgroundWorkpool.enqueueAction(
      ctx,
      internal.chat.actions.extractMemories,
      args,
      {
        retry: false,
        name: "memory-extraction",
        onComplete: internal.execution.workload_queue_callbacks.reconcileBackgroundWork,
        context: runId ? { runId } : {},
      },
    );
    await linkBackgroundWork(ctx, runId, workId, "memory-extraction");
    return workId;
  },
});
