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
import { resolveEffectiveIntegrations } from "../skills/resolver";
import type { GenerationContext } from "./queries_generation_context";

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
        genCtx.currentUserMessage?.attachments as any,
      ),
      ...deps.tools.attachmentTriggeredDocumentWorkspaceToolNames(
        genCtx.currentUserMessage?.attachments as any,
      ),
    ]));
    const connectedIntegrationIds = genCtx.connectedIntegrationIds;
    const chatDoc = genCtx.chatDoc;
    const userDefaults = genCtx.skillIntegrationDefaults;

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
        settingsDefaults: userDefaults?.integrationDefaults as any,
        personaOverrides: personaDoc?.integrationOverrides as any,
        chatOverrides: chatDoc?.integrationOverrides as any,
        turnOverrides: explicitTurnIntegrationOverrides as any,
        connectedIntegrationIds,
      });
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
          searchSessionId: args.searchSessionId,
          resumeExpected: false,
          videoConfig: args.videoConfig,
          // Pre-resolved overrides to eliminate duplicate queries in participant
          chatSkillOverrides: chatDoc?.skillOverrides as any,
          chatIntegrationOverrides: chatDoc?.integrationOverrides as any,
          personaSkillOverrides: personaDoc?.skillOverrides as any,
          skillDefaults: userDefaults?.skillDefaults as any,
          integrationDefaults: userDefaults?.integrationDefaults as any,
          // Phase 1 instrumentation: scheduler hop #2 latency measurement
          enqueuedAt: deps.now(),
        };
      if (args.drivePickerBatchId) {
        (participantArgs as typeof participantArgs & { drivePickerBatchId: Id<"drivePickerBatches"> })
          .drivePickerBatchId = args.drivePickerBatchId;
      }
      const scheduledId = await ctx.scheduler.runAfter(
        0,
        internal.chat.actions_runtime.runGenerationParticipant,
        participantArgs,
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
