import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { hydrateAttachmentsForRequest } from "../chat/action_image_helpers";
import { resolveMemoryContextForGeneration } from "../chat/action_memory_helpers";
import { buildRequestMessages } from "../chat/helpers";
import type { ContextMessage } from "../chat/helpers_types";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { MODEL_IDS } from "../lib/model_constants";
import { callOpenRouterAdvisorResponses } from "../lib/openrouter_responses";
import { conciseAdvisorFailure } from "../lib/openrouter_responses_error";
import { scheduleBackendAnalytics } from "../analytics/backend_events";
import {
  ADVISOR_ABSOLUTE_TIMEOUT_MS,
  ADVISOR_IDLE_TIMEOUT_MS,
} from "./constants";
import {
  advisorBriefOrDefault,
  advisorMaxTokens,
  advisorTemperature,
  isTerminalAdvisorRun,
} from "./shared";
import {
  MAX_ADVISOR_INLINE_FILE_BYTES,
  prepareAdvisorAttachmentMessages,
} from "./attachments";
import { advisorResponsesInput } from "./responses_input";
import { AdvisorStreamWriter } from "./stream_writer";

export const runAdvisor = internalAction({
  args: { runId: v.id("advisorRuns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const leaseOwner = crypto.randomUUID();
    const claimed = await ctx.runMutation(internal.advisors.mutations_internal.claimRun, {
      runId: args.runId,
      leaseOwner,
    });
    if (!claimed) return null;
    const startedAt = Date.now();
    try {
      const execution = await ctx.runQuery(
        internal.advisors.queries.getRunExecutionContext,
        { runId: args.runId },
      );
      if (!execution) throw new Error("Advisor execution context is unavailable.");
      const { run, batch, replayItems } = execution;
      await scheduleBackendAnalytics(ctx, batch.userId, "advisor_consultation_started", {
        chat_id: String(batch.chatId),
        advisor_batch_id: String(batch._id),
        advisor_run_id: String(run._id),
        persona_id: String(run.personaId),
        model_id: run.requestedModelId,
        web_search_enabled: run.allowWebSearch,
        advisor_count: batch.expectedRunCount,
      });
      const capabilities = await ctx.runQuery(internal.chat.queries.getModelCapabilities, {
        modelId: run.requestedModelId,
      });
      const attachmentMessages = prepareAdvisorAttachmentMessages(
        execution.messages,
        capabilities?.hasFileInput === true,
      );
      const hydrated = await hydrateAttachmentsForRequest(ctx, attachmentMessages, {
        inlineStoredNonImageAttachments: capabilities?.hasFileInput === true,
        maxTotalStoredNonImageBytes: capabilities?.hasFileInput === true
          ? MAX_ADVISOR_INLINE_FILE_BYTES
          : undefined,
      });
      const memoryContext = await resolveMemoryContextForGeneration(ctx, {
        messages: hydrated.map((message) => ({
          _id: message._id as Id<"messages">,
          role: message.role,
          content: message.content,
        })),
        userMessageId: batch.userMessageId,
        userId: batch.userId,
        personaId: run.personaId,
        chatId: batch.chatId,
        assistantMessageId: batch.assistantMessageIds[0],
        requireZdr: false,
      });
      const requestMessages = buildRequestMessages({
        messages: hydrated as unknown as ContextMessage[],
        excludeMessageId: batch.assistantMessageIds[0],
        memoryContext: memoryContext || undefined,
        expandMultiModelGroups: true,
        maxContextTokens: Math.max(4_000, (capabilities?.contextLength ?? 75_000) - 4_096),
      });
      const input = advisorResponsesInput(
        requestMessages,
        replayItems,
        advisorBriefOrDefault(run.brief),
        {
          allowImages: capabilities?.hasImageInput === true,
          allowFiles: capabilities?.hasFileInput === true,
          forwardTranscript: true,
        },
      );
      const writer = new AdvisorStreamWriter(ctx, run._id, leaseOwner);
      await ctx.runMutation(internal.advisors.mutations_internal.markRunConsulting, {
        runId: run._id,
        leaseOwner,
      });
      const apiKey = await getRequiredUserOpenRouterApiKey(ctx, batch.userId);
      const result = await callOpenRouterAdvisorResponses(apiKey, {
        dispatcherModel: MODEL_IDS.advisorDispatcher,
        input,
        instanceName: run.instanceName,
        advisorModel: run.requestedModelId,
        advisorInstructions: run.resolvedInstructions,
        allowWebSearch: run.allowWebSearch,
        maxCompletionTokens: advisorMaxTokens(run.personaSnapshot.maxTokens),
        temperature: advisorTemperature(run.personaSnapshot.temperature),
        reasoningEffort: run.personaSnapshot.includeReasoning === false
          ? undefined
          : run.personaSnapshot.reasoningEffort,
        idleTimeoutMs: ADVISOR_IDLE_TIMEOUT_MS,
        absoluteTimeoutMs: ADVISOR_ABSOLUTE_TIMEOUT_MS,
        isCancelled: async () => {
          const current = await ctx.runQuery(
            internal.advisors.queries.getRunInternal,
            { runId: run._id },
          );
          return !current
            || isTerminalAdvisorRun(current.status)
            || current.leaseOwner !== leaseOwner
            || (current.leaseExpiresAt ?? 0) <= Date.now();
        },
      }, {
        onAdviceDelta: async (delta) => await writer.append(delta),
      });
      await writer.flush();
      const finalAdvice = result.advice.trim() || writer.totalContent.trim();
      const finalization = await ctx.runMutation(internal.advisors.mutations_internal.finalizeRun, {
        runId: run._id,
        leaseOwner,
        status: "completed",
        advice: finalAdvice,
        actualModelId: result.actualModelId,
        responseId: result.responseId,
        outputItemId: result.outputItemId,
        replayItems: result.replayItems,
        usage: result.usage ?? undefined,
      });
      if (!finalization.changed) return null;
      await scheduleBackendAnalytics(ctx, batch.userId, "advisor_consultation_completed", {
        chat_id: String(batch.chatId),
        advisor_batch_id: String(batch._id),
        advisor_run_id: String(run._id),
        persona_id: String(run.personaId),
        model_id: result.actualModelId ?? run.requestedModelId,
        web_search_enabled: run.allowWebSearch,
        duration_ms: Date.now() - startedAt,
        cost_usd: result.usage?.cost ?? null,
        status: "completed",
      });
    } catch (error) {
      const current = await ctx.runQuery(internal.advisors.queries.getRunInternal, {
        runId: args.runId,
      });
      if (!current || isTerminalAdvisorRun(current.status)) return null;
      const batch = await ctx.runQuery(internal.advisors.queries.getBatchInternal, {
        batchId: current.batchId,
      });
      const parsed = advisorError(error);
      const status = parsed.code === "ADVISOR_TIMEOUT" ? "timedOut" : "failed";
      const finalization = await ctx.runMutation(internal.advisors.mutations_internal.finalizeRun, {
        runId: current._id,
        leaseOwner,
        status,
        errorCode: parsed.code,
        errorMessage: parsed.message,
      });
      if (!finalization.changed) return null;
      if (batch) {
        await scheduleBackendAnalytics(ctx, batch.userId, "advisor_consultation_failed", {
          chat_id: String(batch.chatId),
          advisor_batch_id: String(batch._id),
          advisor_run_id: String(current._id),
          persona_id: String(current.personaId),
          model_id: current.requestedModelId,
          web_search_enabled: current.allowWebSearch,
          duration_ms: Date.now() - startedAt,
          status,
          error_code: parsed.code,
        });
      }
    }
    return null;
  },
});

function advisorError(error: unknown): { code: string; message: string } {
  if (error && typeof error === "object") {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object") {
      const code = (data as { code?: unknown }).code;
      const message = (data as { message?: unknown }).message;
      if (typeof code === "string" && typeof message === "string") {
        return { code, message: conciseAdvisorFailure(message) };
      }
    }
  }
  return {
    code: "ADVISOR_FAILED",
    message: conciseAdvisorFailure(error),
  };
}
