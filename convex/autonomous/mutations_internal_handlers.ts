import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";

export interface UpdateProgressArgs extends Record<string, unknown> {
  sessionId: Id<"autonomousSessions">;
  currentCycle: number;
  currentParticipantIndex?: number;
}

export async function updateProgressHandler(
  ctx: MutationCtx,
  args: UpdateProgressArgs,
): Promise<void> {
  await ctx.db.patch(args.sessionId, {
    currentCycle: args.currentCycle,
    currentParticipantIndex: args.currentParticipantIndex,
    updatedAt: Date.now(),
  });
}

export interface UpdateParentMessageIdsArgs extends Record<string, unknown> {
  sessionId: Id<"autonomousSessions">;
  parentMessageIds: Id<"messages">[];
}

export async function updateParentMessageIdsHandler(
  ctx: MutationCtx,
  args: UpdateParentMessageIdsArgs,
): Promise<void> {
  await ctx.db.patch(args.sessionId, {
    parentMessageIds: args.parentMessageIds,
    updatedAt: Date.now(),
  });
}

export interface CompleteSessionArgs extends Record<string, unknown> {
  sessionId: Id<"autonomousSessions">;
  status: "completed_consensus" | "completed_max_cycles" | "failed";
  stopReason?: string;
  error?: string;
}

export async function completeSessionHandler(
  ctx: MutationCtx,
  args: CompleteSessionArgs,
): Promise<void> {
  await ctx.db.patch(args.sessionId, {
    status: args.status,
    stopReason: args.stopReason,
    error: args.error,
    updatedAt: Date.now(),
  });
}

export interface ShouldContinueArgs extends Record<string, unknown> {
  sessionId: Id<"autonomousSessions">;
}

export async function shouldContinueHandler(
  ctx: MutationCtx,
  args: ShouldContinueArgs,
): Promise<boolean> {
  const session = await ctx.db.get(args.sessionId);
  if (!session) return false;
  return session.status === "running";
}
