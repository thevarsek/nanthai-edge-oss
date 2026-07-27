// convex/autonomous/actions.ts
// =============================================================================
// Stable autonomous action registrations.
// =============================================================================

"use node";

import { internalAction } from "../_generated/server";
import { runCycleArgs } from "./actions_args";
import { v } from "convex/values";
import { runAutonomousTurnHandler } from "./actions_run_turn_handler";
import { finishAutonomousCycleHandler } from "./actions_finish_cycle";

export const runAutonomousTurn = internalAction({
  args: { ...runCycleArgs, participantIndex: v.number() },
  returns: v.object({
    kind: v.union(
      v.literal("completed"),
      v.literal("skipped"),
      v.literal("failed"),
      v.literal("terminal"),
    ),
  }),
  handler: runAutonomousTurnHandler,
});

export const finishAutonomousCycle = internalAction({
  args: {
    sessionId: v.id("autonomousSessions"),
    cycle: v.number(),
    userId: v.string(),
    executionEpoch: v.optional(v.number()),
  },
  returns: v.union(v.literal("continue"), v.literal("terminal")),
  handler: finishAutonomousCycleHandler,
});
