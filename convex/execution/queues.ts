import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { runGenerationArgs } from "../chat/actions_args";
import { enqueueRunGeneration as enqueueRunGenerationHandler } from
  "../chat/run_generation_queue";

export const enqueueRunGeneration = internalMutation({
  args: runGenerationArgs,
  returns: v.string(),
  handler: enqueueRunGenerationHandler,
});
