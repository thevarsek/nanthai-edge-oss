import { v } from "convex/values";
import type { EventId } from "@convex-dev/workflow";
import type { WorkflowCtx } from "@convex-dev/workflow";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { durableWorkflow } from "../execution/components";
import {
  generationParticipantWorkflowArgs,
  generationResumeEventValue,
  type GenerationParticipantWorkflowArgs,
  type GenerationResumeEventValue,
} from "./workflow_events";
import { nextGenerationEventOffset } from "./generation_event_offset";

export { nextGenerationEventOffset } from "./generation_event_offset";

/**
 * Bounds only one Workflow component's journal. Reaching this boundary starts
 * a linked successor Workflow; it is not a user, run, or tool-round limit.
 */
export const GENERATION_WORKFLOW_ROUNDS_PER_CHUNK = 24;

const TERMINAL_GENERATION_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timedOut",
]);

export async function runGenerationParticipantWorkflowHandler(
  step: WorkflowCtx,
  args: GenerationParticipantWorkflowArgs,
): Promise<null> {
  const {
    durableChain,
    journalProtocolVersion: _journalProtocolVersion,
    ...participantArgs
  } = args;
  let resumeExpected = durableChain?.resumeExpected ?? args.resumeExpected === true;
  let drivePickerBatchId = durableChain?.drivePickerBatchId ?? args.drivePickerBatchId;
  let nextEventOffset = durableChain?.nextEventOffset ?? "0";
  let executionAttemptId = args.executionAttemptId;
  let executionFence = args.executionFence;
  let rebindDeferredFromEventId = durableChain?.rebindDeferredFromEventId;

  for (
    let invocation = 0;
    invocation < GENERATION_WORKFLOW_ROUNDS_PER_CHUNK;
    invocation += 1
  ) {
    const eventOffset = nextEventOffset;
    nextEventOffset = nextGenerationEventOffset(nextEventOffset);
    const eventName = `gen:${eventOffset}`;
    const workflowResumeEventId = await step.runMutation(
      internal.chat.workflow_events.createGenerationResume,
      { workflowId: step.workflowId, name: eventName },
    ) as EventId<string>;
    if (rebindDeferredFromEventId) {
      const rebound = await step.runMutation(
        internal.chat.workflow_recovery.rebindDeferredResume,
        {
          jobId: args.participant.jobId,
          userId: args.userId,
          oldEventId: rebindDeferredFromEventId,
          newEventId: workflowResumeEventId,
          executionAttemptId,
          executionFence,
        },
      );
      if (!rebound) throw new Error("GENERATION_DEFERRED_EVENT_REBIND_FAILED");
      rebindDeferredFromEventId = undefined;
      const resume = await step.awaitEvent<GenerationResumeEventValue>({
        id: workflowResumeEventId,
        validator: generationResumeEventValue,
      });
      resumeExpected = resume.mode === "checkpoint";
      drivePickerBatchId = resume.drivePickerBatchId
        ? resume.drivePickerBatchId as Id<"drivePickerBatches">
        : drivePickerBatchId;
      continue;
    }
    const roundStart = await step.runMutation(
      internal.chat.generation_round_journal.beginRound,
      {
        jobId: args.participant.jobId,
        userId: args.userId,
        roundKey: workflowResumeEventId,
        workflowId: String(step.workflowId),
        eventOffset,
        executionAttemptId,
        executionFence,
      },
    );
    if (roundStart === "stale") return null;
    if (roundStart === "outcome_unknown") {
      throw new Error("GENERATION_ROUND_OUTCOME_UNKNOWN");
    }
    if (roundStart === "committed") {
      resumeExpected = true;
      continue;
    }
    await step.runAction(
      internal.chat.actions_runtime.runGenerationParticipant,
      {
        ...participantArgs,
        drivePickerBatchId,
        resumeExpected,
        executionAttemptId,
        executionFence,
        workflowManaged: true,
        workflowResumeEventId,
      },
      { retry: false },
    );
    const job = await step.runQuery(internal.chat.queries.getGenerationJobInternal, {
      jobId: args.participant.jobId,
    });
    if (!job || TERMINAL_GENERATION_STATUSES.has(job.status)) return null;
    executionAttemptId = job.executionAttemptId ?? executionAttemptId;
    executionFence = job.executionFence ?? executionFence;
    const continuation = await step.runQuery(
      internal.chat.queries.getGenerationContinuationInternal,
      { jobId: args.participant.jobId },
    );
    if (continuation) {
      if (continuation.deferredResumeEventId) {
        const resume = await step.awaitEvent<GenerationResumeEventValue>({
          id: workflowResumeEventId,
          validator: generationResumeEventValue,
        });
        if (
          resume.mode === "fresh"
          && continuation.deferredOwnership?.kind !== "drive_picker"
        ) {
          throw new Error("GENERATION_DEFERRED_CHECKPOINT_RESUME_MODE");
        }
        resumeExpected = resume.mode === "checkpoint";
        drivePickerBatchId = resume.drivePickerBatchId
          ? resume.drivePickerBatchId as Id<"drivePickerBatches">
          : drivePickerBatchId;
      } else {
        resumeExpected = true;
      }
      continue;
    }
    const capabilities = await step.runQuery(internal.chat.queries.getModelCapabilities, {
      modelId: args.participant.modelId,
    });
    if (capabilities?.hasVideoGeneration === true) {
      // Video polling is already its own durable Workflow and owns the
      // generation job until terminal state.
      return null;
    }
    // A nonterminal action may only return after persisting a continuation or
    // handing the job to the independently durable video workflow. Waiting on
    // an otherwise unowned event leaves the user at "..." forever.
    throw new Error("GENERATION_ACTION_RETURNED_WITHOUT_DURABLE_OWNER");
  }

  // The mutation rechecks job and fence state atomically before starting the
  // successor, so cancellation or completion racing this boundary wins.
  await step.runMutation(internal.chat.workflow_events.startGenerationSuccessor, {
    ...participantArgs,
    journalProtocolVersion: args.journalProtocolVersion,
    executionAttemptId,
    executionFence,
    predecessorWorkflowId: String(step.workflowId),
    durableChain: {
      nextEventOffset,
      resumeExpected,
      ...(drivePickerBatchId ? { drivePickerBatchId } : {}),
    },
  });
  return null;
}

export const runGenerationParticipantWorkflow = durableWorkflow
  .define({
    args: generationParticipantWorkflowArgs,
    returns: v.null(),
  })
  .handler(runGenerationParticipantWorkflowHandler);
