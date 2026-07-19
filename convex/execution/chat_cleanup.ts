import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function deleteChatExecutionBatch(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  limit: number,
): Promise<boolean> {
  const teardownTasks = await ctx.db
    .query("executionTeardownTasks")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(limit);
  for (const task of teardownTasks) await ctx.db.delete(task._id);
  const runs = await ctx.db
    .query("executionRuns")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(limit);
  let hasMore = runs.length === limit || teardownTasks.length === limit;
  for (const run of runs) {
    const [commands, events, operations, attempts, components] = await Promise.all([
      ctx.db.query("runtimeCommands").withIndex("by_run_command", (q) => q.eq("runId", run._id)).take(limit),
      ctx.db.query("runEvents").withIndex("by_run_sequence", (q) => q.eq("runId", run._id)).take(limit),
      ctx.db.query("executionOperations").withIndex("by_run_operation", (q) => q.eq("runId", run._id)).take(limit),
      ctx.db.query("executionAttempts").withIndex("by_run", (q) => q.eq("runId", run._id)).take(limit),
      ctx.db.query("executionComponentRefs").withIndex("by_run", (q) => q.eq("runId", run._id)).take(limit),
    ]);
    const bindings = (await Promise.all(attempts.map((attempt) =>
      ctx.db
        .query("runtimeSessionBindings")
        .withIndex("by_attempt", (q) => q.eq("attemptId", attempt._id))
        .take(limit),
    ))).flat();
    for (const row of [...commands, ...events, ...operations, ...bindings, ...components]) {
      await ctx.db.delete(row._id);
    }
    const childrenRemain = [commands, events, operations, bindings, components]
      .some((rows) => rows.length === limit);
    if (childrenRemain) {
      hasMore = true;
      continue;
    }
    for (const attempt of attempts) await ctx.db.delete(attempt._id);
    if (attempts.length === limit) {
      hasMore = true;
      continue;
    }
    await ctx.db.delete(run._id);
  }
  return hasMore;
}
