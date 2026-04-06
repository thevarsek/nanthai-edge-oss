"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { runSubagentRunHandler } from "./actions_run_subagent";
import { continueParentAfterSubagentsHandler } from "./actions_continue_parent";

export const runSubagentRun = internalAction({
  args: { runId: v.id("subagentRuns") },
  handler: runSubagentRunHandler,
});

export const continueSubagentRun = internalAction({
  args: { runId: v.id("subagentRuns") },
  handler: runSubagentRunHandler,
});

export const continueParentAfterSubagents = internalAction({
  args: { batchId: v.id("subagentBatches") },
  handler: continueParentAfterSubagentsHandler,
});
