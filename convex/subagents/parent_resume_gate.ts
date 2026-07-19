import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { SUBAGENT_RECOVERY_LEASE_MS } from "./shared";

const gateRef = makeFunctionReference<"mutation">(
  "subagents/parent_resume_gate:runParentResumeGate",
);

export async function scheduleInitialParentResumeGates(
  ctx: Pick<MutationCtx, "scheduler">,
  batchId: Id<"subagentBatches">,
): Promise<void> {
  const args = { batchId, expectedGateAt: undefined };
  await ctx.scheduler.runAfter(0, gateRef, args);
  await ctx.scheduler.runAfter(SUBAGENT_RECOVERY_LEASE_MS + 30_000, gateRef, args);
}

export async function markBatchWaitingAndArmParentResumeHandler(
  ctx: MutationCtx,
  args: { batchId: Id<"subagentBatches"> },
): Promise<boolean> {
  const batch = await ctx.db.get(args.batchId);
  if (!batch || batch.status !== "running_children") return false;
  const now = Date.now();
  await ctx.db.patch(batch._id, {
    status: "waiting_to_resume",
    continuationScheduledAt: now,
    parentRecoveryScheduledAt: now,
    updatedAt: now,
  });
  await scheduleInitialParentResumeGates(ctx, batch._id);
  return true;
}

export const markBatchWaitingAndArmParentResume = internalMutation({
  args: { batchId: v.id("subagentBatches") },
  returns: v.boolean(),
  handler: markBatchWaitingAndArmParentResumeHandler,
});

export async function scheduleParentResumeGate(
  ctx: Pick<MutationCtx, "scheduler">,
  args: {
    batchId: Id<"subagentBatches">;
    expectedGateAt?: number;
    delayMs?: number;
  },
): Promise<void> {
  await ctx.scheduler.runAfter(args.delayMs ?? SUBAGENT_RECOVERY_LEASE_MS, gateRef, {
    batchId: args.batchId,
    expectedGateAt: args.expectedGateAt,
  });
}

export async function runParentResumeGateHandler(
  ctx: MutationCtx,
  args: { batchId: Id<"subagentBatches">; expectedGateAt?: number },
): Promise<"settled" | "superseded" | "dispatched"> {
  const batch = await ctx.db.get(args.batchId);
  if (
    !batch
    || !["waiting_to_resume", "resuming"].includes(batch.status)
    || batch.resumeDeliveredAt !== undefined
  ) return "settled";
  if (batch.parentRecoveryGateAt !== args.expectedGateAt) return "superseded";
  const gateAt = Date.now();
  await ctx.db.patch(batch._id, { parentRecoveryGateAt: gateAt, updatedAt: gateAt });
  await scheduleParentResumeGate(ctx, {
    batchId: batch._id,
    expectedGateAt: gateAt,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.subagents.actions.continueParentAfterSubagents,
    { batchId: batch._id },
  );
  return "dispatched";
}

export const runParentResumeGate = internalMutation({
  args: {
    batchId: v.id("subagentBatches"),
    expectedGateAt: v.optional(v.number()),
  },
  returns: v.union(
    v.literal("settled"),
    v.literal("superseded"),
    v.literal("dispatched"),
  ),
  handler: runParentResumeGateHandler,
});
