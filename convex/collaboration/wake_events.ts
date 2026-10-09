import { type EventId, type WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { durableWorkflow } from "../execution/components";
import { isIgnorableResumeSignalError } from "../chat/workflow_resume_handlers";
import { collaborationExecutionRef } from "./validators";
import { activateWorkScope } from "./work_scope";
import { assertExchangeExecution } from "./lifecycle_mutations";

export async function wakeCollaboration(ctx: MutationCtx, exchangeId: Id<"collaborationExchanges">) {
  const exchange = await ctx.db.get(exchangeId);
  if (!exchange?.wakeEventId) return;
  try {
    await durableWorkflow.sendEvent(ctx, {
      id: exchange.wakeEventId as EventId<string>, validator: v.string(), value: "changed",
    });
  } catch (error) {
    if (!isIgnorableResumeSignalError(error)) throw error;
  }
  await ctx.db.patch(exchange._id, { wakeEventId: undefined });
}

export async function wakeWorkChat(ctx: MutationCtx, chatId: Id<"chats">) {
  const exchanges = await ctx.db.query("collaborationExchanges")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId)).order("desc").take(5);
  const rows = await ctx.db.query("collaborationWork").withIndex("by_chat", q => q.eq("chatId", chatId)).collect();
  for (const exchange of exchanges) {
    if (["queued", "scheduling", "dispatching", "waiting"].includes(exchange.status)) {
      const legacy = rows.filter(row => row.deferred === undefined && row.status !== "done" && row.status !== "cancelled").map(row => row._id);
      const ids = [...new Set([...(exchange.workIds ?? rows.filter(row => row.deferred !== true).map(row => row._id)), ...legacy])];
      if (ids.length) await ctx.db.patch(exchange._id, { workEnabled: true, workIds: await activateWorkScope(ctx, rows, ids) });
      await wakeCollaboration(ctx, exchange._id);
    }
  }
}

export const armWake = internalMutation({
  args: { exchangeId: v.id("collaborationExchanges"), execution: collaborationExecutionRef },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const exchange = await assertExchangeExecution(ctx, args.exchangeId, args.execution);
    if (!exchange.workflowId) throw new Error("COLLABORATION_WORKFLOW_MISSING");
    if (exchange.wakeEventId) return exchange.wakeEventId;
    const eventId = String(await durableWorkflow.createEvent(ctx, {
      workflowId: exchange.workflowId as WorkflowId,
      name: `collaboration:${exchange.currentWave}:${Date.now()}`,
    }));
    await ctx.db.patch(exchange._id, { wakeEventId: eventId });
    // This one-shot notification wakes the existing Workflow; it is not a second engine.
    await ctx.scheduler.runAt(exchange.bounds.deadlineAt, internal.collaboration.wake_events.deadlineWake, {
      exchangeId: exchange._id, eventId,
    });
    return eventId;
  },
});

export const deadlineWake = internalMutation({
  args: { exchangeId: v.id("collaborationExchanges"), eventId: v.string() },
  handler: async (ctx, args) => {
    const exchange = await ctx.db.get(args.exchangeId);
    if (exchange?.wakeEventId === args.eventId) await wakeCollaboration(ctx, args.exchangeId);
    return null;
  },
});
