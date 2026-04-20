"use node";

import { internalAction } from "../_generated/server";
import { runGenerationParticipantArgs } from "./actions_args";
import { runGenerationParticipantHandler } from "./actions_run_generation_participant_action";

export const runGenerationParticipantNode = internalAction({
  args: runGenerationParticipantArgs,
  handler: runGenerationParticipantHandler,
});
