import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";

type ParentOutcome = "completed" | "failed" | "cancelled" | "interrupted";
type GroupStatus = Doc<"runtimeNativeAgentGroups">["status"];

const CLOSE_BATCH_SIZE = 100;
const closeChildrenRef = makeFunctionReference<"mutation">(
  "runtime_host/native_agent_lifecycle:closeNativeAgentChildren",
);

export async function closeRuntimeNativeAgentGroupForAttempt(
  ctx: MutationCtx,
  args: {
    attemptId: Id<"executionAttempts">;
    fence: number;
    outcome: ParentOutcome;
    now: number;
  },
): Promise<void> {
  const group = await groupForAttempt(ctx, args.attemptId);
  if (!group || group.fence !== args.fence) return;
  const groupStatus = groupStatusForOutcome(args.outcome);
  const childStatus = args.outcome === "completed" ? "shutdown" : "interrupted";
  const statusSummary = parentCloseSummary(args.outcome);
  await ctx.db.patch(group._id, {
    status: groupStatus,
    completedAt: args.now,
    updatedAt: args.now,
  });
  const hasMore = await closeOpenChildrenBatch(
    ctx,
    group._id,
    childStatus,
    statusSummary,
    args.now,
  );
  if (hasMore) {
    await ctx.scheduler.runAfter(0, closeChildrenRef, {
      groupId: group._id,
      groupStatus,
      childStatus,
      statusSummary,
      now: args.now,
    });
  }
}

export const closeNativeAgentChildren = internalMutation({
  args: {
    groupId: v.id("runtimeNativeAgentGroups"),
    groupStatus: v.union(
      v.literal("completed"), v.literal("failed"),
      v.literal("cancelled"), v.literal("interrupted"),
    ),
    childStatus: v.union(v.literal("shutdown"), v.literal("interrupted")),
    statusSummary: v.string(),
    now: v.number(),
  },
  returns: v.boolean(),
  handler: closeNativeAgentChildrenHandler,
});

export async function closeNativeAgentChildrenHandler(
  ctx: MutationCtx,
  args: {
    groupId: Id<"runtimeNativeAgentGroups">;
    groupStatus: Exclude<GroupStatus, "active">;
    childStatus: "shutdown" | "interrupted";
    statusSummary: string;
    now: number;
  },
): Promise<boolean> {
  const group = await ctx.db.get(args.groupId);
  if (!group || group.status !== args.groupStatus) return true;
  const hasMore = await closeOpenChildrenBatch(
    ctx, group._id, args.childStatus, args.statusSummary, args.now,
  );
  if (hasMore) await ctx.scheduler.runAfter(0, closeChildrenRef, args);
  return !hasMore;
}

async function closeOpenChildrenBatch(
  ctx: MutationCtx,
  groupId: Id<"runtimeNativeAgentGroups">,
  status: "shutdown" | "interrupted",
  statusSummary: string,
  now: number,
): Promise<boolean> {
  const batches = await Promise.all((["pending", "running"] as const).map((active) =>
    ctx.db.query("runtimeNativeAgents")
      .withIndex("by_group_status", (index) =>
        index.eq("groupId", groupId).eq("status", active)
      )
      .take(CLOSE_BATCH_SIZE)
  ));
  const rows = batches.flat().slice(0, CLOSE_BATCH_SIZE);
  for (const row of rows) {
    await ctx.db.patch(row._id, {
      status,
      statusSummary,
      completedAt: now,
      updatedAt: now,
    });
  }
  return rows.length === CLOSE_BATCH_SIZE
    || batches.some((batch) => batch.length === CLOSE_BATCH_SIZE);
}

async function groupForAttempt(
  ctx: MutationCtx,
  attemptId: Id<"executionAttempts">,
): Promise<Doc<"runtimeNativeAgentGroups"> | null> {
  return await ctx.db.query("runtimeNativeAgentGroups")
    .withIndex("by_attempt", (index) => index.eq("attemptId", attemptId))
    .unique();
}

function groupStatusForOutcome(outcome: ParentOutcome): Exclude<GroupStatus, "active"> {
  return outcome;
}

function parentCloseSummary(outcome: ParentOutcome): string {
  if (outcome === "completed") {
    return "Parent runtime completed before this native agent reported a terminal state";
  }
  return `Parent runtime ${outcome} before this native agent reported a terminal state`;
}
