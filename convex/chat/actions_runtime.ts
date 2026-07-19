import { internalAction } from "../_generated/server";
import {
  runGenerationArgs,
  runGenerationParticipantArgs,
} from "./actions_args";
import { runGenerationHandler } from "./actions_run_generation_handler";
import { runGenerationParticipantRuntimeHandler } from "./actions_run_generation_participant_runtime";

export const runGeneration = internalAction({
  args: runGenerationArgs,
  handler: runGenerationHandler,
});

export const runGenerationForDurableDispatch = internalAction({
  args: runGenerationArgs,
  handler: async (ctx, args) => await runGenerationHandler(
    ctx,
    args,
    undefined,
    { deferTerminalFailureToWorkflow: true },
  ),
});

export const runGenerationParticipant = internalAction({
  args: runGenerationParticipantArgs,
  handler: runGenerationParticipantRuntimeHandler,
});
