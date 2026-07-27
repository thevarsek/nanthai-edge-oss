"use node";

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import {
  TERMINAL_GENERATION_JOB_STATUSES,
} from "../chat/generation_continuation_shared";
import type { ToolResult } from "../tools/registry";
import type { DeferredPresentationWorkflowArgs } from "./deferred_workflow_refs";
import { getProjectInternalRef } from "./action_refs";
import { safePresentationErrorMessage } from "./limits";

const completeDeferredToolRef = makeFunctionReference<
  "mutation",
  {
    jobId: Id<"generationJobs">;
    userId: string;
    toolCallId: string;
    toolName: string;
    result: string;
    isError?: boolean;
    eventId: string;
  },
  "resumed" | "duplicate" | "missing" | "terminal"
>("chat/workflow_events:completeDeferredTool") as unknown as FunctionReference<
  "mutation",
  "internal",
  {
    jobId: Id<"generationJobs">;
    userId: string;
    toolCallId: string;
    toolName: string;
    result: string;
    isError?: boolean;
    eventId: string;
  },
  "resumed" | "duplicate" | "missing" | "terminal"
>;

async function resumeParentWithResult(
  ctx: ActionCtx,
  args: DeferredPresentationWorkflowArgs,
  result: ToolResult,
): Promise<void> {
  const [job, project] = await Promise.all([
    ctx.runQuery(internal.chat.queries.getGenerationJobInternal, {
      jobId: args.jobId,
    }),
    ctx.runQuery(getProjectInternalRef, {
      projectId: args.projectId,
      userId: args.userId,
    }),
  ]);
  if (!job || TERMINAL_GENERATION_JOB_STATUSES.has(job.status)) return;
  if (job.userId !== args.userId) return;
  const eventId = project?.parentResumeEventId ?? args.workflowResumeEventId;
  if (!eventId) {
    throw new Error("PRESENTATION_PARENT_WORKFLOW_EVENT_REQUIRED");
  }
  const content = JSON.stringify(result.success
    ? result.data
    : {
      error: result.error,
      ...(result.data && typeof result.data === "object"
        ? result.data as Record<string, unknown>
        : {}),
    });
  const resumeStatus = await ctx.runMutation(completeDeferredToolRef, {
    jobId: args.jobId,
    userId: args.userId,
    toolCallId: args.toolCallId,
    toolName: "create_presentation",
    result: content,
    ...(result.success ? {} : { isError: true }),
    eventId,
  });
  if (resumeStatus === "missing") {
    throw new Error("PRESENTATION_PARENT_CHECKPOINT_NOT_FOUND");
  }
}

export async function failAndResume(
  ctx: ActionCtx,
  args: DeferredPresentationWorkflowArgs,
  error: unknown,
): Promise<void> {
  await resumeParentWithResult(ctx, args, {
    success: false,
    data: {
      presentationProjectId: args.projectId,
      retryable: false,
      backendRepairAttempted: true,
    },
    error: safePresentationErrorMessage(error),
  });
}

export async function completeAndResume(
  ctx: ActionCtx,
  args: DeferredPresentationWorkflowArgs,
  result: ToolResult,
): Promise<void> {
  await resumeParentWithResult(ctx, args, result);
}
