import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  matchesPresentationExecution,
  type PresentationExecutionIdentity,
} from "./generation_execution_identity";
import {
  adoptLegacyPresentationExecutionRef,
  cancelAdoptedLegacyPresentationExecutionRef,
  type AdoptedPresentationExecution,
} from "./generation_fanout_refs";
import { presentationError } from "./limits";

type OptionalPresentationExecutionIdentity = {
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
};

function suppliedExecutionIdentity(
  args: OptionalPresentationExecutionIdentity,
): PresentationExecutionIdentity | undefined {
  const { executionAttemptId, executionFence } = args;
  const hasAttempt = executionAttemptId !== undefined;
  const hasFence = executionFence !== undefined;
  if (hasAttempt !== hasFence) {
    throw presentationError(
      "INVALID_STATE",
      "Presentation action execution identity is incomplete.",
    );
  }
  if (executionAttemptId === undefined || executionFence === undefined) return undefined;
  return { executionAttemptId, executionFence };
}

export async function resolvePresentationActionContext<
  Context extends { run: Doc<"presentationGenerationRuns"> },
>(
  ctx: ActionCtx,
  args: OptionalPresentationExecutionIdentity,
  loadContext: () => Promise<Context | null>,
): Promise<Context | null> {
  const supplied = suppliedExecutionIdentity(args);
  const context = await loadContext();
  if (!context) return null;
  if (supplied) {
    return matchesPresentationExecution(context.run, supplied) ? context : null;
  }
  const adopted: AdoptedPresentationExecution | null = await ctx.runMutation(
    adoptLegacyPresentationExecutionRef,
    { runId: context.run._id },
  );
  if (!adopted) return null;
  return {
    ...context,
    run: { ...context.run, ...adopted },
  };
}

export async function cancelUnfencedPresentationAction(
  ctx: ActionCtx,
  args: OptionalPresentationExecutionIdentity,
  run: Doc<"presentationGenerationRuns">,
): Promise<void> {
  if (args.executionAttemptId !== undefined || args.executionFence !== undefined) return;
  const { executionAttemptId, executionFence } = run;
  if (!executionAttemptId || executionFence === undefined) return;
  await ctx.runMutation(cancelAdoptedLegacyPresentationExecutionRef, {
    runId: run._id,
    executionAttemptId,
    executionFence,
  });
}
