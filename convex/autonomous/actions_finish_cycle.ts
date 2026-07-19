import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { checkConsensusInternal } from "./actions_helpers";
import type { Id } from "../_generated/dataModel";

export async function finishAutonomousCycleHandler(
  ctx: ActionCtx,
  args: {
    sessionId: Id<"autonomousSessions">;
    cycle: number;
    userId: string;
    executionEpoch?: number;
    workflowManaged?: boolean;
  },
): Promise<"continue" | "terminal"> {
  try {
    const session = await ctx.runQuery(internal.autonomous.queries.getSession, {
      sessionId: args.sessionId,
    });
    if (!session || session.status !== "running" ||
        (args.executionEpoch !== undefined && session.executionEpoch !== args.executionEpoch)) {
      return "terminal";
    }
    if (session.autoStopOnConsensus) {
      const consensus = await checkConsensusInternal(
        ctx,
        session.chatId,
        session.turnOrder.length,
        args.userId,
      );
      if (consensus) {
        await ctx.runMutation(internal.autonomous.mutations.completeSession, {
          sessionId: args.sessionId,
          status: "completed_consensus",
          stopReason: "Consensus detected",
          executionEpoch: args.executionEpoch,
        });
        return "terminal";
      }
    }
    if (args.cycle >= session.maxCycles) {
      await ctx.runMutation(internal.autonomous.mutations.completeSession, {
        sessionId: args.sessionId,
        status: "completed_max_cycles",
        stopReason: "Max cycles reached",
        executionEpoch: args.executionEpoch,
      });
      return "terminal";
    }
    return "continue";
  } catch (error) {
    if (args.workflowManaged) throw error;
    await ctx.runMutation(internal.autonomous.mutations.completeSession, {
      sessionId: args.sessionId,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      stopReason: "Autonomous consensus check failed",
      executionEpoch: args.executionEpoch,
    });
    throw error;
  }
}
