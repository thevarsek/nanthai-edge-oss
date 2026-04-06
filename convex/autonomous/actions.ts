// convex/autonomous/actions.ts
// =============================================================================
// Stable autonomous action registrations.
// =============================================================================

import { internalAction } from "../_generated/server";
import { runCycleArgs } from "./actions_args";
import { runCycleHandler } from "./actions_run_cycle_handler";

export const runCycle = internalAction({
  args: runCycleArgs,
  handler: runCycleHandler,
});
