import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { appendRunEventUnchecked } from "./events";
import type {
  ExecutionPlacement,
  ExecutionRunKind,
  ExecutorKind,
} from "./validators";

export interface InitialAttemptSpec {
  executorKind: ExecutorKind;
  placement: ExecutionPlacement;
  adapterId: string;
  adapterVersion?: string;
  provider?: string;
  modelId?: string;
  runtimeLabel?: string;
  deviceId?: string;
  workspaceId?: string;
  protocolVersion?: string;
  orchestrationEngine?: "legacy_scheduler" | "convex_workflow" | "convex_workpool" | "runtime_adapter";
  orchestrationVersion?: string;
  rolloutCohort?: string;
}

export interface CreateExecutionRunArgs {
  userId: string;
  kind: ExecutionRunKind;
  requestedPlacement: ExecutionPlacement;
  runKey?: string;
  chatId?: Id<"chats">;
  sourceMessageId?: Id<"messages">;
  generationJobId?: Id<"generationJobs">;
  domainType?: string;
  domainId?: string;
  parentRunId?: Id<"executionRuns">;
  initialAttempt: InitialAttemptSpec;
  now?: number;
}

export interface CreatedExecution {
  runId: Id<"executionRuns">;
  attemptId: Id<"executionAttempts">;
  fence: number;
  leaseExpiresAt: number;
}

export async function createExecutionRun(
  ctx: MutationCtx,
  args: CreateExecutionRunArgs,
): Promise<CreatedExecution> {
  const now = args.now ?? Date.now();
  const orchestrationEngine = args.initialAttempt.orchestrationEngine
    ?? (args.initialAttempt.executorKind === "local_runtime"
      || args.initialAttempt.executorKind === "external_cloud"
      ? "runtime_adapter"
      : "convex_workflow");
  const deletionTombstone = await ctx.db
    .query("accountDeletionTombstones")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .unique();
  if (deletionTombstone) throw new Error("ACCOUNT_DELETION_IN_PROGRESS");
  if (args.runKey) {
    const existing = await ctx.db
      .query("executionRuns")
      .withIndex("by_user_run_key", (q) =>
        q.eq("userId", args.userId).eq("runKey", args.runKey),
      )
      .unique();
    if (existing?.activeAttemptId) {
      const attempt = await ctx.db.get(existing.activeAttemptId);
      if (attempt) {
        return {
          runId: existing._id,
          attemptId: attempt._id,
          fence: attempt.fence,
          leaseExpiresAt: attempt.leaseExpiresAt ?? now,
        };
      }
    }
  }
  const parent = args.parentRunId ? await ctx.db.get(args.parentRunId) : null;
  if (args.parentRunId && (!parent || parent.userId !== args.userId)) {
    throw new Error("INVALID_EXECUTION_PARENT");
  }
  if (parent && ["cancelling", "completed", "failed", "cancelled"].includes(parent.state)) {
    throw new Error("EXECUTION_PARENT_NOT_WRITABLE");
  }
  const effectiveChatId = args.chatId ?? parent?.chatId;
  if (effectiveChatId) {
    const chat = await ctx.db.get(effectiveChatId);
    if (!chat || chat.userId !== args.userId || chat.isDeleting === true) {
      throw new Error("EXECUTION_CHAT_NOT_WRITABLE");
    }
  }
  const runId = await ctx.db.insert("executionRuns", {
    userId: args.userId,
    runKey: args.runKey,
    chatId: effectiveChatId,
    sourceMessageId: args.sourceMessageId,
    generationJobId: args.generationJobId,
    domainType: args.domainType,
    domainId: args.domainId,
    parentRunId: args.parentRunId,
    rootRunId: parent?.rootRunId ?? parent?._id,
    kind: args.kind,
    state: "queued",
    requestedPlacement: args.requestedPlacement,
    nextAttemptNumber: 2,
    nextFence: 2,
    nextEventSequence: 1,
    createdAt: now,
    updatedAt: now,
  });
  const attemptId = await ctx.db.insert("executionAttempts", {
    runId,
    userId: args.userId,
    attemptNumber: 1,
    ...args.initialAttempt,
    protocolVersion: args.initialAttempt.protocolVersion ?? "nanthai-execution-v1",
    orchestrationEngine,
    orchestrationVersion: args.initialAttempt.orchestrationVersion ?? "m47-v1",
    rolloutCohort: args.initialAttempt.rolloutCohort ?? "default",
    status: "queued",
    fence: 1,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(runId, { activeAttemptId: attemptId });
  const run = await ctx.db.get(runId);
  if (!run) throw new Error("EXECUTION_RUN_CREATE_FAILED");
  await appendRunEventUnchecked(ctx, run, {
    attemptId,
    fence: 1,
    type: "created",
    summary: "Execution queued",
    now,
  });
  return { runId, attemptId, fence: 1, leaseExpiresAt: now };
}
