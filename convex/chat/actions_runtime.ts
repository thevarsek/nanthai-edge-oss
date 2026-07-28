// V8 runtime boundary for bounded chat coordination and participant rounds.
// Do not add "use node" here: Node-required media, document, integration, and
// expanded-profile work must delegate through actions_node.ts after the
// runtime-safety preflight. Keeping this registration module in V8 avoids
// paying a Node action startup before every provider request.

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

export const runGenerationParticipant = internalAction({
  args: runGenerationParticipantArgs,
  handler: runGenerationParticipantRuntimeHandler,
});
