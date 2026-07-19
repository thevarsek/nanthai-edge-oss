import { v } from "convex/values";
import type { WorkflowCtx } from "@convex-dev/workflow";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { durableWorkflow } from "../execution/components";
import { submitVideoGenerationArgs } from "./actions_args";

const FAST_POLL_COUNT = 4;
const FAST_POLL_INTERVAL_MS = 15_000;
const SLOW_POLL_INTERVAL_MS = 30_000;
const MAX_POLL_COUNT = 40;

const executionIdentity = {
  runId: v.id("executionRuns"),
  attemptId: v.id("executionAttempts"),
  fence: v.number(),
  claimantId: v.string(),
};

export const runVideoGenerationWorkflow = durableWorkflow
  .define({
    args: { ...submitVideoGenerationArgs, execution: v.object(executionIdentity) },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    try {
      await step.runMutation(internal.execution.mutations.heartbeat, {
        attemptId: args.execution.attemptId,
        fence: args.execution.fence,
        claimantId: args.execution.claimantId,
        leaseMs: 20 * 60 * 1000,
      });
      await step.runAction(internal.chat.actions.submitVideoGenerationStep, {
        chatId: args.chatId,
        userMessageId: args.userMessageId,
        assistantMessageIds: args.assistantMessageIds,
        generationJobIds: args.generationJobIds,
        participant: args.participant,
        userId: args.userId,
        searchSessionId: args.searchSessionId,
        drivePickerBatchId: args.drivePickerBatchId,
        videoConfig: args.videoConfig,
        analytics: args.analytics,
        analyticsSource: args.analyticsSource,
        execution: args.execution,
      }, { retry: false });

      const videoJob = await step.runQuery(internal.chat.video_queries.getByMessage, {
        messageId: args.participant.messageId,
      });
      if (!videoJob || videoJob.status === "completed" || videoJob.status === "failed") {
        await terminalize(step, args.execution, videoJob?.status === "completed" ? "completed" : "failed");
        return null;
      }

      for (let poll = 0; poll < MAX_POLL_COUNT; poll += 1) {
        if (poll > 0) {
          await step.sleep(poll < FAST_POLL_COUNT ? FAST_POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS);
        }
        await step.runMutation(internal.execution.mutations.heartbeat, {
          attemptId: args.execution.attemptId,
          fence: args.execution.fence,
          claimantId: args.execution.claimantId,
          leaseMs: 20 * 60 * 1000,
        });
        await step.runAction(internal.chat.actions.pollVideoGeneration, {
          videoJobId: videoJob._id,
          chatId: args.chatId,
          userMessageId: args.userMessageId,
          assistantMessageIds: args.assistantMessageIds,
          generationJobIds: args.generationJobIds,
          messageId: args.participant.messageId,
          jobId: args.participant.jobId,
          userId: args.userId,
          searchSessionId: args.searchSessionId,
          drivePickerBatchId: args.drivePickerBatchId,
          analytics: args.analytics,
          analyticsSource: args.analyticsSource,
          workflowManaged: true,
          executionAttemptId: args.execution.attemptId,
          executionFence: args.execution.fence,
          executionClaimantId: args.execution.claimantId,
        }, { retry: false });
        const current = await step.runQuery(internal.chat.queries.getVideoJobInternal, {
          videoJobId: videoJob._id,
        });
        if (!current || current.status === "completed" || current.status === "failed") {
          await terminalize(step, args.execution, current?.status === "failed" ? "failed" : "completed");
          return null;
        }
      }
      await terminalize(step, args.execution, "failed");
      return null;
    } catch (error) {
      await step.runAction(internal.chat.actions.failVideoWorkflow, {
        chatId: args.chatId,
        userMessageId: args.userMessageId,
        assistantMessageIds: args.assistantMessageIds,
        generationJobIds: args.generationJobIds,
        participant: args.participant,
        userId: args.userId,
        searchSessionId: args.searchSessionId,
        drivePickerBatchId: args.drivePickerBatchId,
        videoConfig: args.videoConfig,
        analytics: args.analytics,
        analyticsSource: args.analyticsSource,
        error: error instanceof Error ? error.message : String(error),
      }, { retry: false }).catch(() => undefined);
      await terminalize(step, args.execution, "failed", error).catch(() => undefined);
      throw error;
    }
  });

async function terminalize(
  step: WorkflowCtx,
  execution: { attemptId: Id<"executionAttempts">; fence: number; claimantId: string },
  outcome: "completed" | "failed",
  error?: unknown,
): Promise<void> {
  await step.runMutation(internal.execution.mutations.terminalize, {
    attemptId: execution.attemptId,
    fence: execution.fence,
    claimantId: execution.claimantId,
    outcome,
    summary: error instanceof Error ? error.message : outcome === "completed"
      ? "Video generated and published"
      : "Video generation failed",
  });
}
