import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { cancelAdvisorBatchRows } from "../advisors/lifecycle";
import { scheduleCancelledAssistantResponseAnalytics } from "../chat/mutation_send_helpers";
import { requireAuth } from "../lib/auth";
import { backgroundWorkpool } from "../execution/components";
import type { WorkId } from "@convex-dev/workpool";
import { internal } from "../_generated/api";
import { cancelExecutionForGenerationJob } from "../execution/cancellation";
import { requestRunTreeTeardown } from "../execution/teardown_graph";

export function cancellationPlaceholderForMode(
  mode: "paper" | "web" | undefined,
): string {
  if (mode === "web") return "[Web search cancelled]";
  if (mode === "paper") return "[Research paper cancelled]";
  return "[Generation cancelled]";
}

export async function scheduleLegacyResearchWorkflowCancellation(
  ctx: Pick<MutationCtx, "scheduler">,
  session: Pick<Doc<"searchSessions">, "executionRunId" | "workflowId">,
): Promise<boolean> {
  if (session.executionRunId || !session.workflowId) return false;
  await ctx.scheduler.runAfter(
    0,
    internal.execution.workflow_cancel.cancelWorkflow,
    { workflowId: session.workflowId },
  );
  return true;
}

export async function cancelResearchPaperHandler(
  ctx: MutationCtx,
  args: { sessionId: Id<"searchSessions"> },
): Promise<void> {
  const { userId } = await requireAuth(ctx);
  const session = await ctx.db.get(args.sessionId);
  if (!session || session.userId !== userId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Search session not found" });
  }
  if (["completed", "failed", "cancelled"].includes(session.status)) return;

  const now = Date.now();
  if (session.executionRunId) {
    await requestRunTreeTeardown(
      ctx,
      session.executionRunId,
      userId,
      "Research paper cancelled by user",
    );
    await ctx.scheduler.runAfter(0, internal.execution.teardown.cancelRunTree, {
      runId: session.executionRunId,
      requestedBy: userId,
      reason: "Research paper cancelled by user",
    });
  }
  await ctx.db.patch(args.sessionId, { status: "cancelled", completedAt: now });
  const searchBatches = session.mode === "paper"
    ? await ctx.db
        .query("researchSearchBatches")
        .withIndex("by_session", (query) => query.eq("sessionId", session._id))
        .collect()
    : [];
  for (const batch of searchBatches) {
    for (const workId of batch.workpoolOperationIds) {
      try {
        await backgroundWorkpool.cancel(ctx, workId as WorkId);
      } catch {
        // A terminal Workpool item is already durably settled.
      }
    }
    const tasks = await ctx.db
      .query("researchSearchTasks")
      .withIndex("by_batch", (query) => query.eq("batchId", batch._id))
      .collect();
    for (const task of tasks) {
      if (task.status === "queued") {
        await ctx.db.patch(task._id, {
          status: "cancelled",
          error: "Research paper cancelled by user",
          completedAt: now,
        });
      }
    }
    await ctx.db.patch(batch._id, {
      status: "completed",
      terminalCount: tasks.length,
      failedCount: tasks.filter((task) => task.status !== "completed").length,
      completedAt: now,
    });
  }
  // Execution-owned workflows are cancelled once by the run-tree teardown.
  // Keep the direct path only for rows created before execution ownership.
  await scheduleLegacyResearchWorkflowCancellation(ctx, session);
  const message = await ctx.db.get(session.assistantMessageId);
  if (!message) return;
  if (message.advisorBatchId) {
    const batch = await ctx.db.get(message.advisorBatchId);
    if (batch) await cancelAdvisorBatchRows(ctx, batch);
  }

  const jobs = await ctx.db
    .query("generationJobs")
    .withIndex("by_message", (query) => query.eq("messageId", session.assistantMessageId))
    .collect();
  for (const job of jobs) {
    if (["completed", "failed", "cancelled", "timedOut"].includes(job.status)) continue;
    await cancelExecutionForGenerationJob(ctx, {
      jobId: job._id,
      requestedBy: userId,
      now,
    });
    await ctx.db.patch(job._id, {
      status: "cancelled",
      completedAt: now,
      terminalErrorCode: "cancelled_by_user",
    });
    await scheduleCancelledAssistantResponseAnalytics(ctx, job, message);
  }

  if (message.status !== "completed") {
    await ctx.db.patch(session.assistantMessageId, {
      status: "cancelled",
      content: message.content || cancellationPlaceholderForMode(session.mode),
      terminalErrorCode: "cancelled_by_user",
    });
  }
}
