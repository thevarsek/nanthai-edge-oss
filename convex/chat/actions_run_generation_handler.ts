"use node";

import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { failPendingParticipants } from "./actions_run_generation_failures";
import { prepareGenerationContext } from "./actions_run_generation_context";
import { generateForParticipant } from "./actions_run_generation_participant";
import { RunGenerationArgs } from "./actions_run_generation_types";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import {
  checkAppleCalendarConnection,
  checkMicrosoftConnection,
  checkNotionConnection,
  getGrantedGoogleIntegrations,
} from "../tools/index";
import { buildProgressiveToolRegistry } from "../tools/progressive_registry";
import { attachmentTriggeredReadToolNames } from "./helpers_attachment_utils";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";

export type { RunGenerationArgs } from "./actions_run_generation_types";

const defaultRunGenerationHandlerDeps = {
  now: () => Date.now(),
  generation: {
    failPendingParticipants,
    prepareGenerationContext,
    generateForParticipant,
    getRequiredUserOpenRouterApiKey,
  },
  integrations: {
    checkAppleCalendarConnection,
    checkMicrosoftConnection,
    checkNotionConnection,
    getGrantedGoogleIntegrations,
  },
  tools: {
    buildProgressiveToolRegistry,
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
  try {
    const { allMessages, memoryContext, modelCapabilities } =
      await deps.generation.prepareGenerationContext(ctx, args);
    const apiKey = await deps.generation.getRequiredUserOpenRouterApiKey(
      ctx,
      args.userId,
    );

    // M10: Build tool registry once, share across all participants.
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
    const currentUserMessage = allMessages.find(
      (message) => message._id === args.userMessageId,
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
    const toolRegistry = deps.tools.buildProgressiveToolRegistry({
      enabledIntegrations: effectiveIntegrations,
      isPro: isProUser,
      allowSubagents: args.subagentsEnabled === true && args.participants.length === 1,
      hasSandboxRuntime: accountCapabilities.hasSandboxRuntime,
      directToolNames,
    });

    const generationResults = await Promise.all(
      args.participants.map((participant) =>
        deps.generation.generateForParticipant({
          ctx,
          args,
          participant,
          allMessages,
          memoryContext,
          modelCapabilities,
          toolRegistry,
          progressiveTools: {
            enabledIntegrations: effectiveIntegrations,
            allowSubagents:
              args.subagentsEnabled === true && args.participants.length === 1,
            hasSandboxRuntime: accountCapabilities.hasSandboxRuntime,
            directToolNames,
          },
          isPro: isProUser,
          runtimeProfile: accountCapabilities.hasSandboxRuntime
            ? "mobileSandbox"
            : "mobileBasic",
          apiKey,
          actionStartTime,
        }),
      ),
    );

    // AUDIT-1: Skip postProcess when all participants were cancelled or failed
    // — no useful content was generated, so title generation and memory
    // extraction would be wasteful.
    const anyDeferred = generationResults.some((r) => r.deferredForSubagents);
    const allCancelled = generationResults.every((r) => r.cancelled);
    const anyFailed = generationResults.some((r) => r.failed);
    const allCancelledOrFailed = generationResults.every(
      (r) => r.cancelled || r.failed,
    );

    if (!anyDeferred && !allCancelledOrFailed) {
      await ctx.scheduler.runAfter(0, internal.chat.actions.postProcess, {
        chatId: args.chatId,
        userMessageId: args.userMessageId,
        assistantMessageIds: args.assistantMessageIds,
        userId: args.userId,
      });
    }

    // If this runGeneration was scheduled from a search path (C/D/regen),
    // determine the final session status from the actual generation outcomes.
    // generateForParticipant catches cancellation internally and returns
    // normally with `cancelled: true`, so we check that flag here.
    // AUDIT-2: Don't finalize the session when deferred for subagents — the
    // subagent continuation handler will finalize it when all children complete.
    if (args.searchSessionId && !anyDeferred) {
      const anyCancelled = generationResults.some((r) => r.cancelled);

      if (allCancelled) {
        await ctx.runMutation(internal.search.mutations.updateSearchSession, {
          sessionId: args.searchSessionId,
          patch: {
            status: "cancelled",
            currentPhase: "cancelled",
            completedAt: deps.now(),
          },
        });
      } else if (allCancelledOrFailed) {
        // All participants either cancelled or failed — no successful output
        await ctx.runMutation(internal.search.mutations.updateSearchSession, {
          sessionId: args.searchSessionId,
          patch: {
            status: "failed",
            currentPhase: "failed",
            errorMessage: "All generation participants failed",
            completedAt: deps.now(),
          },
        });
      } else {
        await ctx.runMutation(internal.search.mutations.updateSearchSession, {
          sessionId: args.searchSessionId,
          patch: {
            status: "completed",
            progress: 100,
            currentPhase: "completed",
            completedAt: deps.now(),
          },
        });
        if (anyCancelled || anyFailed) {
          console.warn(
            `[runGeneration] Mixed outcome: cancelled=${anyCancelled}, failed=${anyFailed}, session marked completed`,
          );
        }
      }
    }
  } catch (error) {
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
    await deps.generation.failPendingParticipants(ctx, args, error);
  }
}
