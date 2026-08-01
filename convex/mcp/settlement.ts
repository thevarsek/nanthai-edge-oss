import type { ActionCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";

type SettlementInvocation = Pick<
  Doc<"mcpInvocations">,
  "_id" | "durableRunId" | "durableAttemptId" | "durableFence" | "executionClaimantId"
>;

function settlementArgs(invocation: SettlementInvocation) {
  if (
    !invocation.durableRunId
    || !invocation.durableAttemptId
    || invocation.durableFence === undefined
    || !invocation.executionClaimantId
  ) return undefined;
  return {
    invocationId: invocation._id,
    execution: {
      runId: invocation.durableRunId,
      attemptId: invocation.durableAttemptId,
      fence: invocation.durableFence,
      claimantId: invocation.executionClaimantId,
    },
  };
}

export async function queueMcpInvocationSettlement(
  ctx: Pick<ActionCtx, "runMutation">,
  invocation: SettlementInvocation,
): Promise<boolean> {
  const args = settlementArgs(invocation);
  if (!args) return false;
  try {
    await ctx.runMutation(
      internal.mcp.task_lifecycle.scheduleDeferredInvocationSettlement,
      args,
    );
    return true;
  } catch {
    return false;
  }
}

export async function settleMcpInvocation(
  ctx: Pick<ActionCtx, "runMutation">,
  invocation: SettlementInvocation,
): Promise<void> {
  const args = settlementArgs(invocation);
  if (!args) return;
  await queueMcpInvocationSettlement(ctx, invocation);
  await ctx.runMutation(internal.mcp.task_lifecycle.settleDeferredInvocation, args);
}
