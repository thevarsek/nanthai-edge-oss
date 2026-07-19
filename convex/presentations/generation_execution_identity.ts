import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { heartbeatExecution } from "../execution/control_plane";
import { internal } from "../_generated/api";
import { presentationError } from "./limits";

export type PresentationExecutionIdentity = {
  executionAttemptId: Id<"executionAttempts">;
  executionFence: number;
};

export function presentationExecutionIdentity(run: {
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
}): PresentationExecutionIdentity {
  if (!run.executionAttemptId || run.executionFence === undefined) {
    throw presentationError("INVALID_STATE", "Presentation execution identity is missing.");
  }
  return {
    executionAttemptId: run.executionAttemptId,
    executionFence: run.executionFence,
  };
}

export function matchesPresentationExecution(
  run: {
    executionAttemptId?: Id<"executionAttempts">;
    executionFence?: number;
  },
  identity: PresentationExecutionIdentity,
): boolean {
  return run.executionAttemptId === identity.executionAttemptId
    && run.executionFence === identity.executionFence;
}

export async function renewPresentationExecutionLease(
  ctx: MutationCtx,
  runId: Id<"presentationGenerationRuns">,
  identity: PresentationExecutionIdentity,
): Promise<number> {
  const run = await ctx.db.get(runId);
  if (!run) throw presentationError("NOT_FOUND", "Presentation generation run not found.");
  if (!matchesPresentationExecution(run, identity)) {
    throw presentationError("INVALID_STATE", "Presentation worker belongs to a superseded execution.");
  }
  const project = await ctx.db.get(run.projectId);
  if (!project || project.userId !== run.userId || project.status !== "generating") {
    throw presentationError("INVALID_STATE", "Presentation generation is no longer current.");
  }
  if (!run.executionRunId) {
    throw presentationError("INVALID_STATE", "Presentation execution identity is missing.");
  }
  const [controlRun, attempt] = await Promise.all([
    ctx.db.get(run.executionRunId),
    ctx.db.get(identity.executionAttemptId),
  ]);
  const claimantId = `presentation:${String(run.projectId)}`;
  if (
    !attempt
    || controlRun?.activeAttemptId !== attempt._id
    || attempt.fence !== identity.executionFence
    || attempt.status !== "running"
    || attempt.claimantId !== claimantId
    || (attempt.leaseExpiresAt ?? 0) <= Date.now()
  ) {
    await ctx.scheduler.runAfter(
      0,
      internal.presentations.presentation_workflow_recovery.recoverPresentationWorkflow,
      {
        runId: run._id,
        expectedAttemptId: identity.executionAttemptId,
        expectedFence: identity.executionFence,
      },
    );
    throw presentationError(
      "INVALID_STATE",
      "Presentation execution is being rebound to a replacement Workflow.",
    );
  }
  await heartbeatExecution(ctx, {
    attemptId: attempt._id,
    fence: attempt.fence,
    claimantId,
    leaseMs: 30 * 60 * 1_000,
  });
  return project.revision;
}
