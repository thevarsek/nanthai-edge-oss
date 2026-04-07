import { ConvexError, v, type PropertyValidators } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { ActionCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import {
  GenerationCancelledError,
  isGenerationCancelledError,
} from "../chat/generation_helpers";
import { buildPaperGenerationSystemPrompt } from "./helpers";

const CANCEL_CHECK_INTERVAL_EVENTS = 10;

export function resolveRegenerationFinalContent(
  totalContent: string,
  resultReasoning?: string | null,
  streamedReasoning?: string,
): string {
  const trimmedContent = totalContent.trim();
  if (trimmedContent.length > 0) {
    return trimmedContent;
  }
  if ((resultReasoning ?? "").length > 0 || (streamedReasoning ?? "").length > 0) {
    return "Model returned reasoning only.";
  }
  return "[No response received from model]";
}

export function shouldCheckRegenerationCancellation(deltaEventCount: number): boolean {
  return deltaEventCount % CANCEL_CHECK_INTERVAL_EVENTS === 0;
}

export async function throwIfRegenerationCancelled(
  ctx: ActionCtx,
  jobId: Id<"generationJobs">,
): Promise<void> {
  const cancelled = await ctx.runMutation(
    internal.chat.mutations.isJobCancelled,
    { jobId },
  );
  if (cancelled) {
    throw new GenerationCancelledError();
  }
}

export const regeneratePaperActionArgs = {
  sessionId: v.id("searchSessions"),
  sourceSessionId: v.optional(v.id("searchSessions")),
  assistantMessageId: v.id("messages"),
  jobId: v.id("generationJobs"),
  chatId: v.id("chats"),
  userId: v.string(),
  modelId: v.string(),
  personaId: v.optional(v.id("personas")),
  systemPrompt: v.optional(v.string()),
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.union(v.number(), v.null())),
  includeReasoning: v.optional(v.union(v.boolean(), v.null())),
  reasoningEffort: v.optional(v.union(v.string(), v.null())),
  enabledIntegrations: v.optional(v.array(v.string())),
  subagentsEnabled: v.optional(v.boolean()),
} satisfies PropertyValidators;

/**
 * Regenerate a research paper from cached synthesis data.
 *
 * Instead of doing its own `callOpenRouterStreaming` + tool loop, this now
 * builds the paper system prompt and hands off to `runGeneration` — the full
 * tool-aware pipeline — so the model gets skills, progressive tool loading,
 * memory, compaction, subagents, etc.
 */
export const regeneratePaperAction = internalAction({
  args: regeneratePaperActionArgs,
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.chat.mutations.updateJobStatus, {
      jobId: args.jobId,
      status: "streaming",
      startedAt: Date.now(),
    });
    await ctx.runMutation(internal.search.mutations.updateSearchSession, {
      sessionId: args.sessionId,
      patch: {
        status: "writing",
        progress: 90,
        currentPhase: "writing",
      },
    });

    try {
      const sourceSessionId = args.sourceSessionId ?? args.sessionId;
      const synthesisData = await resolveRegenerationSynthesisData(ctx, sourceSessionId);

      const paperSystemPrompt = buildPaperGenerationSystemPrompt(synthesisData);
      let baseSystemPrompt = args.systemPrompt;
      if (!baseSystemPrompt && args.personaId) {
        const persona = await ctx.runQuery(internal.chat.queries.getPersona, {
          personaId: args.personaId,
          userId: args.userId,
        });
        if (persona?.systemPrompt) {
          baseSystemPrompt = persona.systemPrompt;
        }
      }
      const effectiveSystemPrompt = baseSystemPrompt
        ? `${baseSystemPrompt}\n\n${paperSystemPrompt}`
        : paperSystemPrompt;

      // Resolve the user message ID from the assistant message's parentMessageIds.
      const assistantMsg = await ctx.runQuery(
        internal.chat.queries.getMessageInternal,
        { messageId: args.assistantMessageId },
      );
      const userMessageId = assistantMsg?.parentMessageIds?.[0];
      if (!userMessageId) {
        throw new ConvexError({ code: "INTERNAL_ERROR" as const, message: "Could not resolve user message for regeneration" });
      }

      // Hand off to the full generation pipeline so the model gets skills,
      // progressive tool loading, memory, compaction, subagents, etc.
      await ctx.scheduler.runAfter(0, internal.chat.actions.runGeneration, {
        chatId: args.chatId,
        userMessageId,
        assistantMessageIds: [args.assistantMessageId],
        generationJobIds: [args.jobId],
        participants: [
          {
            modelId: args.modelId,
            personaId: args.personaId ?? null,
            systemPrompt: effectiveSystemPrompt,
            temperature: args.temperature ?? 0.4, // Paper generation default (lower than chat's 0.7)
            maxTokens: args.maxTokens ?? undefined,
            includeReasoning: args.includeReasoning ?? undefined,
            reasoningEffort: args.reasoningEffort ?? null,
            messageId: args.assistantMessageId,
            jobId: args.jobId,
          },
        ],
        userId: args.userId,
        expandMultiModelGroups: true,
        webSearchEnabled: false, // Synthesis data is already available
        enabledIntegrations: args.enabledIntegrations,
        subagentsEnabled: args.subagentsEnabled,
        searchSessionId: args.sessionId,
      });

      // Write stats but keep status as "writing" — runGeneration will mark
      // the session "completed" or "failed" when generation finishes.
      await ctx.runMutation(internal.search.mutations.updateSearchSession, {
        sessionId: args.sessionId,
        patch: {
          status: "writing",
          progress: 90,
          currentPhase: "writing",
          searchCallCount: 0,
          participantCount: 1,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const wasCancelled = isGenerationCancelledError(error);

      await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
        messageId: args.assistantMessageId,
        jobId: args.jobId,
        chatId: args.chatId,
        content: wasCancelled ? "[Research paper cancelled]" : `Error: ${errorMessage}`,
        status: wasCancelled ? "cancelled" : "failed",
        error: errorMessage,
        userId: args.userId,
      });
      try {
        await ctx.runMutation(internal.search.mutations.updateSearchSession, {
          sessionId: args.sessionId,
          patch: {
            status: wasCancelled ? "cancelled" : "failed",
            currentPhase: wasCancelled ? "cancelled" : "failed",
            errorMessage: wasCancelled ? undefined : errorMessage,
            completedAt: Date.now(),
          },
        });
      } catch (sessionError) {
        console.error(
          "[regeneratePaper] Failed to update search session on error:",
          sessionError instanceof Error ? sessionError.message : String(sessionError),
        );
      }
    }
  },
});

export async function resolveRegenerationSynthesisData(
  ctx: ActionCtx,
  sessionId: Id<"searchSessions">,
): Promise<string> {
  const phases = await ctx.runQuery(internal.search.queries.getSearchPhases, {
    sessionId,
  });
  const synthesisPhase = phases
    .filter((p: { phaseType: string }) => p.phaseType === "synthesis")
    .sort((a: { phaseOrder: number }, b: { phaseOrder: number }) => b.phaseOrder - a.phaseOrder)
    .at(0);

  let synthesisData: string | null = coerceToText(synthesisPhase?.data);
  if (synthesisData) {
    return synthesisData;
  }

  const session = await ctx.runQuery(internal.search.queries.getSearchSession, {
    sessionId,
  });
  if (session?.assistantMessageId) {
    const cachedSearchContext = await ctx.runQuery(
      internal.search.queries.getSearchContextByMessage,
      { messageId: session.assistantMessageId },
    );
    synthesisData = coerceToText(cachedSearchContext);
    if (synthesisData) {
      return synthesisData;
    }

    const originalMessage = await ctx.runQuery(
      internal.chat.queries.getMessageInternal,
      { messageId: session.assistantMessageId },
    );
    const originalContent = originalMessage?.content?.trim();
    if (originalContent && originalContent.length > 0) {
      return originalContent;
    }
  }

  return "No structured synthesis data was saved for this session. Regenerate using the available conversation context.";
}

function coerceToText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (value == null) {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
