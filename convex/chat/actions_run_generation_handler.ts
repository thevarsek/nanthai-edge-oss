"use node";

import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { failPendingParticipants } from "./actions_run_generation_failures";
import { RunGenerationArgs } from "./actions_run_generation_types";
import {
  checkAppleCalendarConnection,
  checkMicrosoftConnection,
  checkNotionConnection,
  getGrantedGoogleIntegrations,
} from "../tools/index";
import { attachmentTriggeredReadToolNames } from "./helpers_attachment_utils";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";

export type { RunGenerationArgs } from "./actions_run_generation_types";

const defaultRunGenerationHandlerDeps = {
  now: () => Date.now(),
  generation: {
    failPendingParticipants,
  },
  integrations: {
    checkAppleCalendarConnection,
    checkMicrosoftConnection,
    checkNotionConnection,
    getGrantedGoogleIntegrations,
  },
  tools: {
    attachmentTriggeredReadToolNames,
  },
};

export type RunGenerationHandlerDeps = typeof defaultRunGenerationHandlerDeps;

export function createRunGenerationHandlerDepsForTest(
  overrides: DeepPartial<RunGenerationHandlerDeps> = {},
): RunGenerationHandlerDeps {
  return mergeTestDeps(defaultRunGenerationHandlerDeps, overrides);
}

export async function runGenerationHandler(
  ctx: ActionCtx,
  args: RunGenerationArgs,
  deps: RunGenerationHandlerDeps = defaultRunGenerationHandlerDeps,
): Promise<void> {
  const actionStartTime = deps.now();
  const scheduledParticipants: Array<{
    jobId: Id<"generationJobs">;
    scheduledFunctionId: Id<"_scheduled_functions">;
  }> = [];
  console.info("[runGeneration] started", {
    chatId: args.chatId,
    userMessageId: args.userMessageId,
    userId: args.userId,
    participants: args.participants.map((p) => p.modelId),
    searchSessionId: args.searchSessionId ?? null,
  });
  try {
    // Intersect user-requested integrations with actual OAuth connection status.
    // M14: Check Pro status to gate Pro-only tools.
    const requestedIntegrations = args.enabledIntegrations ?? [];
    let effectiveIntegrations: string[] = [];

    // Check Pro status in parallel with OAuth connections
    const accountCapabilities = await ctx.runQuery(
      internal.capabilities.queries.getAccountCapabilitiesInternal,
      { userId: args.userId },
    );
    const isProUser = accountCapabilities.isPro;
    const currentUserMessage = await ctx.runQuery(
      internal.chat.queries.getMessageInternal,
      { messageId: args.userMessageId },
    );
    const directToolNames = deps.tools.attachmentTriggeredReadToolNames(
      currentUserMessage?.attachments,
    );

    if (requestedIntegrations.length > 0) {
      const googleKeys = ["gmail", "drive", "calendar"];
      const microsoftKeys = ["outlook", "onedrive", "ms_calendar"];
      const appleKeys = ["apple_calendar"];
      const notionKeys = ["notion"];

      const wantsGoogle = requestedIntegrations.some((i) => googleKeys.includes(i));
      const wantsMicrosoft = requestedIntegrations.some((i) => microsoftKeys.includes(i));
      const wantsApple = requestedIntegrations.some((i) => appleKeys.includes(i));
      const wantsNotion = requestedIntegrations.some((i) => notionKeys.includes(i));

      // Check connections in parallel for speed
      const [grantedGoogleIntegrations, hasMicrosoft, hasApple, hasNotion] = await Promise.all([
        wantsGoogle
          ? deps.integrations.getGrantedGoogleIntegrations(
              ctx,
              args.userId,
            )
          : Promise.resolve([]),
        wantsMicrosoft
          ? deps.integrations.checkMicrosoftConnection(
              ctx,
              args.userId,
            )
          : Promise.resolve(false),
        wantsApple
          ? deps.integrations.checkAppleCalendarConnection(
              ctx,
              args.userId,
            )
          : Promise.resolve(false),
        wantsNotion
          ? deps.integrations.checkNotionConnection(
              ctx,
              args.userId,
            )
          : Promise.resolve(false),
      ]);

      if (grantedGoogleIntegrations.length > 0) {
        effectiveIntegrations.push(
          ...requestedIntegrations.filter((i) => grantedGoogleIntegrations.includes(i)),
        );
      }
      if (hasMicrosoft) {
        effectiveIntegrations.push(
          ...requestedIntegrations.filter((i) => microsoftKeys.includes(i)),
        );
      }
      if (hasApple) {
        effectiveIntegrations.push(
          ...requestedIntegrations.filter((i) => appleKeys.includes(i)),
        );
      }
      if (hasNotion) {
        effectiveIntegrations.push(
          ...requestedIntegrations.filter((i) => notionKeys.includes(i)),
        );
      }
    }
    const allowSubagents =
      args.subagentsEnabled === true && args.participants.length === 1;

    for (const participant of args.participants) {
      const scheduledId = await ctx.scheduler.runAfter(
        0,
        internal.chat.actions.runGenerationParticipant,
        {
          chatId: args.chatId,
          userMessageId: args.userMessageId,
          assistantMessageIds: args.assistantMessageIds,
          generationJobIds: args.generationJobIds,
          participant,
          userId: args.userId,
          expandMultiModelGroups: args.expandMultiModelGroups,
          webSearchEnabled: args.webSearchEnabled,
          effectiveIntegrations,
          directToolNames,
          isPro: isProUser,
          allowSubagents,
          searchSessionId: args.searchSessionId,
          resumeExpected: false,
        },
      );
      scheduledParticipants.push({
        jobId: participant.jobId,
        scheduledFunctionId: scheduledId,
      });

      await ctx.runMutation(internal.chat.mutations.setGenerationContinuationScheduled, {
        jobId: participant.jobId,
        scheduledFunctionId: scheduledId,
        updateContinuation: false,
      });
    }

    const durationMs = deps.now() - actionStartTime;
    console.info("[runGeneration] completed", {
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      userId: args.userId,
      durationMs,
      participantCount: args.participants.length,
    });
  } catch (error) {
    const durationMs = deps.now() - actionStartTime;
    const scheduledByJobId = new Map(
      scheduledParticipants.map((participant) => [participant.jobId, participant]),
    );
    const participantsToFinalize = args.participants.filter(
      (participant) => !scheduledByJobId.has(participant.jobId),
    );
    console.error("[runGeneration] failed", {
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      userId: args.userId,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    for (const scheduledParticipant of scheduledParticipants) {
      try {
        await ctx.scheduler.cancel(scheduledParticipant.scheduledFunctionId);
        const cancelledParticipant = args.participants.find(
          (participant) => participant.jobId === scheduledParticipant.jobId,
        );
        if (cancelledParticipant) {
          participantsToFinalize.push(cancelledParticipant);
        }
      } catch {
        // Already executed or cancelled.
      }
      try {
        await ctx.runMutation(internal.chat.mutations.clearGenerationContinuation, {
          jobId: scheduledParticipant.jobId,
        });
      } catch (cleanupError) {
        console.error("[runGeneration] failed to clear scheduled participant", {
          jobId: scheduledParticipant.jobId,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    }
    // If this runGeneration was scheduled from a search path, propagate the
    // failure (or cancellation) to the search session so the UI shows the
    // correct state.
    if (args.searchSessionId) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown generation error";
      const wasCancelled =
        error instanceof Error &&
        error.message.toLowerCase().includes("generation cancelled");
      try {
        await ctx.runMutation(internal.search.mutations.updateSearchSession, {
          sessionId: args.searchSessionId,
          patch: {
            status: wasCancelled ? "cancelled" : "failed",
            currentPhase: wasCancelled ? "cancelled" : "failed",
            errorMessage: wasCancelled ? undefined : errorMessage,
            completedAt: deps.now(),
          },
        });
      } catch (sessionError) {
        console.error(
          "[runGeneration] Failed to update search session on error:",
          sessionError instanceof Error ? sessionError.message : String(sessionError),
        );
      }
    }
    if (participantsToFinalize.length > 0) {
      await deps.generation.failPendingParticipants(ctx, {
        ...args,
        participants: participantsToFinalize,
      }, error);
    }
  }
}
