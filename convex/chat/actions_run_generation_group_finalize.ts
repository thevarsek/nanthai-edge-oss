import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";
import { RunGenerationParticipantArgs } from "./generation_continuation_shared";

const terminalStatuses = new Set([
  "completed",
  "failed",
  "cancelled",
  "timedOut",
]);

const failureStatuses = new Set([
  "failed",
  "cancelled",
  "timedOut",
]);

const defaultMaybeFinalizeGroupDeps = {
  now: () => Date.now(),
};

export type MaybeFinalizeGroupDeps = typeof defaultMaybeFinalizeGroupDeps;

export function createMaybeFinalizeGroupDepsForTest(
  overrides: DeepPartial<MaybeFinalizeGroupDeps> = {},
): MaybeFinalizeGroupDeps {
  return mergeTestDeps(defaultMaybeFinalizeGroupDeps, overrides);
}

export async function maybeFinalizeGenerationGroup(
  ctx: ActionCtx,
  args: Pick<
    RunGenerationParticipantArgs,
    "chatId" | "userId" | "userMessageId" | "assistantMessageIds" | "generationJobIds" | "searchSessionId"
  >,
  deps: MaybeFinalizeGroupDeps = defaultMaybeFinalizeGroupDeps,
): Promise<void> {
  const jobs = await Promise.all(
    args.generationJobIds.map((jobId) =>
      ctx.runQuery(internal.chat.queries.getGenerationJobInternal, { jobId }),
    ),
  );
  if (jobs.some((job) => job == null)) {
    return;
  }

  const statuses = jobs.map((job) => job!.status);
  if (statuses.some((status) => !terminalStatuses.has(status))) {
    return;
  }

  const allCancelled = statuses.every((status) => status === "cancelled");
  const allCancelledOrFailed = statuses.every((status) => failureStatuses.has(status));

  if (!allCancelledOrFailed) {
    const didMark = await ctx.runMutation(
      internal.chat.mutations.markPostProcessScheduled,
      { messageId: args.assistantMessageIds[0] },
    );
    if (didMark) {
      await ctx.scheduler.runAfter(0, internal.chat.actions.postProcess, {
        chatId: args.chatId,
        userMessageId: args.userMessageId,
        assistantMessageIds: args.assistantMessageIds,
        userId: args.userId,
      });
    }
  }

  if (!args.searchSessionId) {
    return;
  }

  if (allCancelled) {
    await ctx.runMutation(internal.search.mutations.updateSearchSession, {
      sessionId: args.searchSessionId,
      patch: {
        status: "cancelled",
        currentPhase: "cancelled",
        completedAt: deps.now(),
      },
    });
    return;
  }

  if (allCancelledOrFailed) {
    await ctx.runMutation(internal.search.mutations.updateSearchSession, {
      sessionId: args.searchSessionId,
      patch: {
        status: "failed",
        currentPhase: "failed",
        errorMessage: "All generation participants failed",
        completedAt: deps.now(),
      },
    });
    return;
  }

  await ctx.runMutation(internal.search.mutations.updateSearchSession, {
    sessionId: args.searchSessionId,
    patch: {
      status: "completed",
      progress: 100,
      currentPhase: "completed",
      completedAt: deps.now(),
    },
  });
}
