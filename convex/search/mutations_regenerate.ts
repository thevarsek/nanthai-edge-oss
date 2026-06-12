import { mutation, MutationCtx } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { requireAuth, requirePro } from "../lib/auth";
import { Id } from "../_generated/dataModel";
import {
  analyticsClientMetadataValidator,
  type AnalyticsClientMetadata,
} from "../analytics/client_metadata";

const REGENERATE_REUSED_PHASE_TYPES = new Set([
  "planning",
  "initial_search",
  "analysis",
  "depth_iteration",
]);

type ReusableResearchPhase = {
  phaseType: "planning" | "initial_search" | "analysis" | "depth_iteration";
  phaseOrder: number;
  iteration?: number;
  status: "pending" | "running" | "completed" | "failed";
  data: unknown;
};

export interface RegeneratePaperArgs extends Record<string, unknown> {
  sessionId: Id<"searchSessions">;
  modelId: string;
  personaId?: Id<"personas">;
  personaName?: string;
  personaEmoji?: string;
  personaAvatarImageUrl?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number | null;
  includeReasoning?: boolean | null;
  reasoningEffort?: string | null;
  enabledIntegrations?: string[];
  subagentsEnabled?: boolean;
  analytics?: AnalyticsClientMetadata;
}

export const regeneratePaper = mutation({
  args: {
    sessionId: v.id("searchSessions"),
    modelId: v.string(),
    personaId: v.optional(v.id("personas")),
    personaName: v.optional(v.string()),
    personaEmoji: v.optional(v.string()),
    personaAvatarImageUrl: v.optional(v.string()),
    systemPrompt: v.optional(v.string()),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.union(v.number(), v.null())),
    includeReasoning: v.optional(v.union(v.boolean(), v.null())),
    reasoningEffort: v.optional(v.union(v.string(), v.null())),
    enabledIntegrations: v.optional(v.array(v.string())),
    subagentsEnabled: v.optional(v.boolean()),
    analytics: v.optional(analyticsClientMetadataValidator),
  },
  returns: v.object({
    assistantMessageId: v.id("messages"),
  }),
  handler: regeneratePaperHandler,
});

export async function regeneratePaperHandler(
  ctx: MutationCtx,
  args: RegeneratePaperArgs,
): Promise<{ assistantMessageId: Id<"messages"> }> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  try {
    const now = Date.now();

    const sourceSession = await ctx.db.get(args.sessionId);
    if (!sourceSession || sourceSession.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Search session not found" });
    }
    if (sourceSession.mode !== "paper") {
      throw new ConvexError({ code: "VALIDATION", message: "Can only regenerate research paper sessions" });
    }
    if (sourceSession.status !== "completed" && sourceSession.status !== "failed") {
      throw new ConvexError({ code: "VALIDATION", message: "Can only regenerate from a completed or failed research paper" });
    }

    const originalMessage = await ctx.db.get(sourceSession.assistantMessageId);
    if (!originalMessage) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Original message not found" });
    }
    const userMessageId = originalMessage.parentMessageIds?.[0];
    if (!userMessageId) {
      throw new ConvexError({ code: "INTERNAL_ERROR", message: "Could not resolve user message for regeneration" });
    }

    const assistantMessageId = await ctx.db.insert("messages", {
      chatId: sourceSession.chatId,
      userId,
      role: "assistant",
      content: "",
      modelId: args.modelId,
      participantId: args.personaId,
      participantName: args.personaName,
      participantEmoji: args.personaEmoji,
      participantAvatarImageUrl: args.personaAvatarImageUrl,
      parentMessageIds: originalMessage.parentMessageIds,
      status: "pending",
      createdAt: now,
    });

    const jobId = await ctx.db.insert("generationJobs", {
      chatId: sourceSession.chatId,
      messageId: assistantMessageId,
      userId,
      modelId: args.modelId,
      status: "queued",
      analytics: args.analytics,
      analyticsSource: "research_paper",
      createdAt: now,
    });

    const regenerationSessionId = await ctx.db.insert("searchSessions", {
      chatId: sourceSession.chatId,
      userId,
      assistantMessageId,
      query: sourceSession.query,
      mode: "paper",
      complexity: sourceSession.complexity,
      status: "synthesizing",
      progress: 75,
      currentPhase: "synthesis",
      phaseOrder: 0,
      participantId: args.personaId ?? undefined,
      startedAt: now,
    });

    await ctx.db.patch(assistantMessageId, { searchSessionId: regenerationSessionId });

    const sourcePhases = await ctx.db
      .query("searchPhases")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    let reusablePhases: ReusableResearchPhase[] = sourcePhases
      .filter((phase) => REGENERATE_REUSED_PHASE_TYPES.has(phase.phaseType))
      .map((phase) => ({
        phaseType: phase.phaseType as ReusableResearchPhase["phaseType"],
        phaseOrder: phase.phaseOrder,
        iteration: phase.iteration,
        status: phase.status,
        data: phase.data,
      }))
      .sort((a, b) => a.phaseOrder - b.phaseOrder);

    if (!reusablePhases.some((phase) => phase.phaseType === "initial_search" || phase.phaseType === "depth_iteration")) {
      const cachedContext = await ctx.db
        .query("searchContexts")
        .withIndex("by_message", (q) => q.eq("messageId", sourceSession.assistantMessageId))
        .first();
      const payload = cachedContext?.payload as { searchResults?: unknown } | undefined;
      const searchResults = Array.isArray(payload?.searchResults) ? payload.searchResults : [];
      if (searchResults.length === 0) {
        throw new ConvexError({
          code: "VALIDATION",
          message: "Cannot regenerate analysis because saved research results are unavailable",
        });
      }
      reusablePhases = [
        {
          phaseType: "planning",
          phaseOrder: 0,
          iteration: undefined,
          status: "completed",
          data: {
            researchQuestion: sourceSession.query,
            plan: `Regenerate synthesis from ${searchResults.length} saved search results.`,
          },
        },
        {
          phaseType: "initial_search",
          phaseOrder: 1,
          iteration: undefined,
          status: "completed",
          data: { results: searchResults },
        },
      ];
    }

    for (const phase of reusablePhases) {
      await ctx.db.insert("searchPhases", {
        sessionId: regenerationSessionId,
        phaseType: phase.phaseType,
        phaseOrder: phase.phaseOrder,
        iteration: phase.iteration,
        status: phase.status,
        data: phase.data,
        startedAt: now,
        completedAt: now,
      });
    }

    const nextPhaseOrder =
      reusablePhases.reduce((max, phase) => Math.max(max, phase.phaseOrder), -1) + 1;

    await ctx.scheduler.runAfter(
      0,
      internal.search.workflow_durable.runSynthesisAction,
      {
        sessionId: regenerationSessionId,
        assistantMessageId,
        jobId,
        chatId: sourceSession.chatId,
        userMessageId,
        userId,
        query: sourceSession.query,
        modelId: args.modelId,
        personaId: args.personaId ?? undefined,
        systemPrompt: args.systemPrompt ?? undefined,
        temperature: args.temperature ?? undefined,
        maxTokens: args.maxTokens ?? undefined,
        includeReasoning: args.includeReasoning ?? undefined,
        reasoningEffort: args.reasoningEffort ?? undefined,
        complexity: sourceSession.complexity,
        expandMultiModelGroups: false,
        enabledIntegrations: args.enabledIntegrations,
        subagentsEnabled: false,
        analytics: args.analytics,
        phaseOrder: nextPhaseOrder,
      },
    );

    const chat = await ctx.db.get(sourceSession.chatId);
    if (chat) {
      await ctx.db.patch(chat._id, {
        updatedAt: now,
        lastMessageDate: now,
        activeBranchLeafId: assistantMessageId,
        activeBranchLeafFocusOrder: undefined,
        messageCount: (chat.messageCount ?? 0) + 1,
      });
    }

    return { assistantMessageId };
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    console.error("[regeneratePaper] Unexpected mutation failure", {
      sessionId: args.sessionId,
      modelId: args.modelId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new ConvexError({
      code: "INTERNAL_ERROR",
      message: "Regenerate paper failed before generation could start. Please try again.",
    });
  }
}
