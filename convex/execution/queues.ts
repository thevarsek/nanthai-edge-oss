import { internalMutation } from "../_generated/server";
import { runGenerationArgs } from "../chat/actions_args";
import { startGenerationDispatchHandler } from "../chat/generation_dispatch_workflow";

export const enqueueRunGeneration = internalMutation({
  args: runGenerationArgs,
  handler: startGenerationDispatchHandler,
});
