import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";
import { terminalizeAutonomousSession } from "./execution_lifecycle";

export interface UpdateProgressArgs extends Record<string, unknown> {
  sessionId: Id<"autonomousSessions">;
  currentCycle: number;
  currentParticipantIndex?: number;
  executionEpoch?: number;
}

export async function updateProgressHandler(
  ctx: MutationCtx,
  args: UpdateProgressArgs,
): Promise<void> {
  const session = await ctx.db.get(args.sessionId);
  if (!session || session.status !== "running") return;
  if (args.executionEpoch !== undefined && session.executionEpoch !== args.executionEpoch) return;
  await ctx.db.patch(args.sessionId, {
    currentCycle: args.currentCycle,
    currentParticipantIndex: args.currentParticipantIndex,
    updatedAt: Date.now(),
  });
}

export interface UpdateParentMessageIdsArgs extends Record<string, unknown> {
  sessionId: Id<"autonomousSessions">;
  parentMessageIds: Id<"messages">[];
  executionEpoch?: number;
}

export async function updateParentMessageIdsHandler(
  ctx: MutationCtx,
  args: UpdateParentMessageIdsArgs,
): Promise<void> {
  const session = await ctx.db.get(args.sessionId);
  if (!session || session.status !== "running") return;
  if (args.executionEpoch !== undefined && session.executionEpoch !== args.executionEpoch) return;
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
  executionEpoch?: number;
}

export async function completeSessionHandler(
  ctx: MutationCtx,
  args: CompleteSessionArgs,
): Promise<void> {
  const session = await ctx.db.get(args.sessionId);
  if (!session || session.status !== "running") return;
  if (args.executionEpoch !== undefined && session.executionEpoch !== args.executionEpoch) return;
  await terminalizeAutonomousSession(
    ctx,
    session,
    args.status === "failed" ? "failed" : "completed",
    args.stopReason ?? args.error ?? args.status,
  );
  await ctx.db.patch(args.sessionId, {
    status: args.status,
    stopReason: args.stopReason,
    error: args.error,
    updatedAt: Date.now(),
  });
}

export interface ShouldContinueArgs extends Record<string, unknown> {
  sessionId: Id<"autonomousSessions">;
  executionEpoch?: number;
}

export async function shouldContinueHandler(
  ctx: MutationCtx,
  args: ShouldContinueArgs,
): Promise<boolean> {
  const session = await ctx.db.get(args.sessionId);
  if (!session) return false;
  return session.status === "running"
    && (args.executionEpoch === undefined || session.executionEpoch === args.executionEpoch);
}
