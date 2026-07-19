import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { completeBatchForMessageHandler } from "../advisors/mutations_internal";
import { enqueuePostProcessOnceHandler } from "../execution/workload_queues";

const TERMINAL = new Set(["completed", "failed", "cancelled", "timedOut"]);
const FAILED = new Set(["failed", "cancelled", "timedOut"]);

export async function reconcileGenerationTerminalHooks(
  ctx: MutationCtx,
  args: {
    assistantMessageIds: Id<"messages">[];
    generationJobIds: Id<"generationJobs">[];
    chatId: Id<"chats">;
    userMessageId: Id<"messages">;
    userId: string;
    searchSessionId?: Id<"searchSessions">;
    subagentBatchId?: Id<"subagentBatches">;
    drivePickerBatchId?: Id<"drivePickerBatches">;
  },
): Promise<void> {
  if (args.subagentBatchId) {
    const batch = await ctx.db.get(args.subagentBatchId);
    if (batch?.status === "resuming") {
      const job = await ctx.db.get(batch.parentJobId);
      const status = job?.status === "cancelled"
        ? "cancelled"
        : job?.status === "completed" ? "completed" : "failed";
      await ctx.db.patch(batch._id, { status, updatedAt: Date.now() });
    }
  }
  if (args.drivePickerBatchId) {
    const batch = await ctx.db.get(args.drivePickerBatchId);
    if (batch) {
      const job = await ctx.db.get(batch.parentJobId);
      const status = job?.status === "cancelled"
        ? "cancelled"
        : job?.status === "completed" ? "completed" : "failed";
      await ctx.db.patch(batch._id, { status, updatedAt: Date.now() });
      const message = await ctx.db.get(batch.parentMessageId);
      if (message) await ctx.db.patch(message._id, { drivePickerBatchId: undefined });
    }
  }

  // Orphan discovery is bounded and restartable. Parent terminalization must
  // never share a transaction with an unbounded number of child tool rows.
  for (const jobId of args.generationJobIds) {
    await ctx.scheduler.runAfter(
      0,
      internal.chat.generation_orphan_cleanup.reconcileGenerationOwnedChildren,
      { jobId },
    );
  }

  for (const messageId of args.assistantMessageIds) {
    await ctx.scheduler.runAfter(
      0,
      internal.chat.generation_orphan_cleanup.reconcileGenerationOwnedPresentations,
      { assistantMessageId: messageId },
    );
  }

  const jobs = await Promise.all(args.generationJobIds.map((id) => ctx.db.get(id)));
  if (jobs.some((job) => !job || !TERMINAL.has(job.status))) return;
  const statuses = jobs.flatMap((job) => job ? [job.status] : []);
  if (args.assistantMessageIds[0]) {
    await completeBatchForMessageHandler(ctx, {
      messageId: args.assistantMessageIds[0],
    });
  }
  if (!statuses.every((status) => FAILED.has(status))) {
    await enqueuePostProcessOnceHandler(ctx, {
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      assistantMessageIds: args.assistantMessageIds,
      userId: args.userId,
    });
  }
  if (!args.searchSessionId) return;
  const session = await ctx.db.get(args.searchSessionId);
  if (!session || ["completed", "failed", "cancelled"].includes(session.status)) return;
  const allCancelled = statuses.every((status) => status === "cancelled");
  const allFailed = statuses.every((status) => FAILED.has(status));
  const now = Date.now();
  await ctx.db.patch(session._id, allCancelled
    ? { status: "cancelled", currentPhase: "cancelled", completedAt: now }
    : allFailed
      ? {
          status: "failed",
          currentPhase: "failed",
          errorMessage: "All generation participants failed",
          completedAt: now,
        }
      : { status: "completed", progress: 100, currentPhase: "completed", completedAt: now });
}
