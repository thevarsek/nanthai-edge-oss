import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { cancelAdvisorBatchRows } from "../advisors/lifecycle";
import { scheduleCancelledAssistantResponseAnalytics } from "../chat/mutation_send_helpers";
import { requireAuth } from "../lib/auth";

export function cancellationPlaceholderForMode(
  mode: "paper" | "web" | undefined,
): string {
  if (mode === "web") return "[Web search cancelled]";
  if (mode === "paper") return "[Research paper cancelled]";
  return "[Generation cancelled]";
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
  await ctx.db.patch(args.sessionId, { status: "cancelled", completedAt: now });
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
