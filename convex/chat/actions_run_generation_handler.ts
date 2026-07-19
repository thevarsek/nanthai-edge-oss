import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { failPendingParticipants } from "./actions_run_generation_failures";
import { RunGenerationArgs } from "./actions_run_generation_types";
import {
  attachmentTriggeredDocumentWorkspaceToolNames,
  attachmentTriggeredReadToolNames,
} from "./helpers_attachment_utils";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";
import { analyticsClientProperties } from "../analytics/client_metadata";
import { resolveEffectiveIntegrations } from "../skills/resolver";
import type { GenerationContext } from "./queries_generation_context";
import type { ContextAttachment } from "./helpers_types";
import { sanitizeImageGenerationConfig } from "../preferences/image_defaults";
import { durableWorkflow } from "../execution/components";

export type { RunGenerationArgs } from "./actions_run_generation_types";

const defaultRunGenerationHandlerDeps = {
  now: () => Date.now(),
  generation: {
    failPendingParticipants,
  },
  tools: {
    attachmentTriggeredReadToolNames,
    attachmentTriggeredDocumentWorkspaceToolNames,
  },
  execution: {
    ensureGeneration: async (ctx: ActionCtx, jobId: Id<"generationJobs">) =>
      await ctx.runMutation(internal.execution.mutations.ensureGeneration, { jobId }),
    dispatchParticipant: async (
      ctx: ActionCtx,
      participantArgs: Parameters<typeof durableWorkflow.start>[2],
    ): Promise<string> => {
      return await ctx.runMutation(
        internal.chat.workflow_events.startGenerationWorkflow,
        participantArgs,
      ) ?? "generation-not-started";
    },
    cancelParticipant: async (ctx: ActionCtx, operationId: string): Promise<void> => {
      await durableWorkflow.cancel(ctx, operationId as never);
    },
  },
};

export type RunGenerationHandlerDeps = typeof defaultRunGenerationHandlerDeps;

export function createRunGenerationHandlerDepsForTest(
  overrides: DeepPartial<RunGenerationHandlerDeps> = {},
): RunGenerationHandlerDeps {
  const testDeps: RunGenerationHandlerDeps = {
    ...defaultRunGenerationHandlerDeps,
    execution: {
      ensureGeneration: async () => null,
      dispatchParticipant: async (ctx, participantArgs) => {
        const scheduledFunctionId = await ctx.scheduler.runAfter(
          0,
          internal.chat.actions_runtime.runGenerationParticipant,
          participantArgs,
        );
        await ctx.runMutation(internal.chat.mutations.setGenerationContinuationScheduled, {
          jobId: participantArgs.participant.jobId,
          scheduledFunctionId,
          updateContinuation: false,
        });
        return String(scheduledFunctionId);
      },
      cancelParticipant: async (ctx, operationId) => {
        await ctx.scheduler.cancel(operationId as Id<"_scheduled_functions">);
      },
    },
  };
  return mergeTestDeps(testDeps, overrides);
}

export async function runGenerationHandler(
  ctx: ActionCtx,
  args: RunGenerationArgs,
  deps: RunGenerationHandlerDeps = defaultRunGenerationHandlerDeps,
  options: { deferTerminalFailureToWorkflow?: boolean } = {},
): Promise<void> {
  const actionStartTime = deps.now();
  const scheduledParticipants: Array<{
    jobId: Id<"generationJobs">;
    operationId: string;
  }> = [];
  // Phase 1 instrumentation: scheduler hop #1 latency (sendMessage/retry enqueue → handler entry)
  const schedulerHop1Ms =
    typeof args.enqueuedAt === "number" ? actionStartTime - args.enqueuedAt : null;
  console.info("[runGeneration] started", {
    chatId: args.chatId,
    userMessageId: args.userMessageId,
    userId: args.userId,
    participants: args.participants.map((p) => p.modelId),
    jobIds: args.participants.map((p) => p.jobId),
    searchSessionId: args.searchSessionId ?? null,
    schedulerHop1Ms,
    ...analyticsClientProperties(args.analytics),
  });
  try {
    // Consolidated preflight: single query replaces ~13 individual round-trips.
    const uniquePersonaIds = [...new Set(
      args.participants
        .map((participant) => participant.personaId)
        .filter((personaId): personaId is NonNullable<typeof personaId> => personaId != null),
    )].map(String);

    const genCtx: GenerationContext = await ctx.runQuery(
      internal.chat.queries_generation_context.getGenerationContext,
      {
        userId: args.userId,
        chatId: args.chatId,
        messageId: args.userMessageId,
        personaIds: uniquePersonaIds,
      },
    );

    const isProUser = genCtx.isPro;
    const directToolNames = Array.from(new Set([
      ...deps.tools.attachmentTriggeredReadToolNames(
        genCtx.currentUserMessage?.attachments as ContextAttachment[] | undefined,
      ),
      ...deps.tools.attachmentTriggeredDocumentWorkspaceToolNames(
        genCtx.currentUserMessage?.attachments as ContextAttachment[] | undefined,
      ),
    ]));
    const connectedIntegrationIds = genCtx.connectedIntegrationIds;
    const chatDoc = genCtx.chatDoc;
    const userDefaults = genCtx.skillIntegrationDefaults;
    const imageConfig = args.imageConfig === undefined
      ? genCtx.imageConfig
      : (sanitizeImageGenerationConfig(args.imageConfig) ?? {});

    // Turn-level integration overrides. New clients send the structured
    // `turnIntegrationOverrides: [{integrationId, enabled}]` shape. Legacy
    // clients (and existing tests) still send `enabledIntegrations: string[]`,
    // meaning "enable exactly these for this turn". When only the legacy field
    // is present, synthesize turn overrides from it (each ID → enabled:true).
    // Legacy clients cannot express "disable" at the turn layer via this shape;
    // any integration not listed falls through to chat > persona > settings >
    // default (disabled) in resolveEffectiveIntegrations — which matches the
    // original allowlist semantics those clients assumed.
    // Structured overrides always win if both are supplied.
    const explicitTurnIntegrationOverrides =
      args.turnIntegrationOverrides ??
      (args.enabledIntegrations
        ? args.enabledIntegrations.map((integrationId: string) => ({
            integrationId,
            enabled: true,
          }))
        : undefined);
    const allowSubagents =
      args.subagentsEnabled === true && args.participants.length === 1;

    for (const participant of args.participants) {
      const participantDispatchStartedAt = deps.now();
      console.info("[runGeneration] participant dispatch started", {
        chatId: args.chatId,
        messageId: participant.messageId,
        jobId: participant.jobId,
        modelId: participant.modelId,
      });
      const personaDoc = participant.personaId
        ? genCtx.personasById[String(participant.personaId)] ?? null
        : null;
      const resolvedIntegrations = resolveEffectiveIntegrations({
        settingsDefaults: userDefaults?.integrationDefaults,
        personaOverrides: personaDoc?.integrationOverrides,
        chatOverrides: chatDoc?.integrationOverrides,
        turnOverrides: explicitTurnIntegrationOverrides,
        connectedIntegrationIds,
      });
      const execution = await deps.execution.ensureGeneration(ctx, participant.jobId);
      const participantArgs = {
          chatId: args.chatId,
          userMessageId: args.userMessageId,
          assistantMessageIds: args.assistantMessageIds,
          generationJobIds: args.generationJobIds,
          participant,
          userId: args.userId,
          expandMultiModelGroups: args.expandMultiModelGroups,
          webSearchEnabled: args.webSearchEnabled,
          effectiveIntegrations: resolvedIntegrations.effectiveIntegrations,
          directToolNames,
          isPro: isProUser,
          allowSubagents,
          disableTools: args.disableTools,
          searchSessionId: args.searchSessionId,
          resumeExpected: false,
          videoConfig: args.videoConfig,
          imageConfig,
          // Pre-resolved overrides to eliminate duplicate queries in participant
          chatSkillOverrides: chatDoc?.skillOverrides,
          chatIntegrationOverrides: chatDoc?.integrationOverrides,
          personaSkillOverrides: personaDoc?.skillOverrides,
          skillDefaults: userDefaults?.skillDefaults,
          integrationDefaults: userDefaults?.integrationDefaults,
          // Phase 1 instrumentation: scheduler hop #2 latency measurement
          enqueuedAt: deps.now(),
        };
      if (execution) {
        Object.assign(participantArgs, {
          executionAttemptId: execution.attemptId,
          executionFence: execution.fence,
        });
      }
      if (args.analytics) {
        (participantArgs as typeof participantArgs & { analytics: NonNullable<RunGenerationArgs["analytics"]> })
          .analytics = args.analytics;
      }
      if (args.analyticsSource) {
        (participantArgs as typeof participantArgs & { analyticsSource: NonNullable<RunGenerationArgs["analyticsSource"]> })
          .analyticsSource = args.analyticsSource;
      }
      if (args.drivePickerBatchId) {
        (participantArgs as typeof participantArgs & { drivePickerBatchId: Id<"drivePickerBatches"> })
          .drivePickerBatchId = args.drivePickerBatchId;
      }
      if (args.requireZdrOverride === true) {
        (participantArgs as typeof participantArgs & { requireZdrOverride: boolean })
          .requireZdrOverride = true;
      }
      const operationId = await deps.execution.dispatchParticipant(ctx, participantArgs);
      scheduledParticipants.push({
        jobId: participant.jobId,
        operationId,
      });
      console.info("[runGeneration] participant dispatch scheduled", {
        chatId: args.chatId,
        messageId: participant.messageId,
        jobId: participant.jobId,
        modelId: participant.modelId,
        durationMs: deps.now() - participantDispatchStartedAt,
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
    if (options.deferTerminalFailureToWorkflow) {
      // Successfully started participant Workflows are idempotently discovered
      // on retry. Leave them running and let the outer durable Workflow retry
      // only the coordinator work that did not finish.
      throw error;
    }
    for (const scheduledParticipant of scheduledParticipants) {
      try {
        await deps.execution.cancelParticipant(ctx, scheduledParticipant.operationId);
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
    if (args.drivePickerBatchId) {
      try {
        await ctx.runMutation(internal.drive_picker.mutations.completeBatch, {
          batchId: args.drivePickerBatchId,
          status: "failed",
        });
      } catch (batchError) {
        console.error(
          "[runGeneration] Failed to mark Drive picker batch failed:",
          batchError instanceof Error ? batchError.message : String(batchError),
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
