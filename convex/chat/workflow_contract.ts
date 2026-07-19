import { type Infer, type ObjectType, v } from "convex/values";
import { runGenerationParticipantArgs } from "./actions_args";

export const generationWorkflowChainState = v.object({
  nextEventOffset: v.string(),
  resumeExpected: v.boolean(),
  drivePickerBatchId: v.optional(v.id("drivePickerBatches")),
  rebindDeferredFromEventId: v.optional(v.string()),
});

export const generationParticipantWorkflowArgs = {
  ...runGenerationParticipantArgs,
  journalProtocolVersion: v.optional(v.literal(1)),
  durableChain: v.optional(generationWorkflowChainState),
};

export type GenerationParticipantWorkflowArgs = ObjectType<
  typeof generationParticipantWorkflowArgs
>;

export type GenerationSuccessorArgs = GenerationParticipantWorkflowArgs & {
  predecessorWorkflowId: string;
  durableChain: Infer<typeof generationWorkflowChainState>;
};
