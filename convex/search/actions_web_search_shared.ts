import { v, type PropertyValidators } from "convex/values";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { ActionCtx } from "../_generated/server";

export const runWebSearchArgs = {
  sessionId: v.id("searchSessions"),
  assistantMessageId: v.id("messages"),
  jobId: v.id("generationJobs"),
  chatId: v.id("chats"),
  userMessageId: v.id("messages"),
  userId: v.string(),
  query: v.string(),
  complexity: v.number(),
  expandMultiModelGroups: v.boolean(),
  // Participant model config for synthesis
  modelId: v.string(),
  personaId: v.optional(v.id("personas")),
  systemPrompt: v.optional(v.string()),
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
  includeReasoning: v.optional(v.boolean()),
  reasoningEffort: v.optional(v.string()),
  // Cached context for retry (skip search, go to synthesis)
  cachedSearchContext: v.optional(v.any()),
  // M10: Tool/integration config so post-search synthesis can use tools
  enabledIntegrations: v.optional(v.array(v.string())),
  subagentsEnabled: v.optional(v.boolean()),
} satisfies PropertyValidators;

export interface WebSearchActionArgs extends Record<string, unknown> {
  sessionId: Id<"searchSessions">;
  assistantMessageId: Id<"messages">;
  jobId: Id<"generationJobs">;
  chatId: Id<"chats">;
  userMessageId: Id<"messages">;
  userId: string;
  query: string;
  complexity: number;
  expandMultiModelGroups: boolean;
  modelId: string;
  personaId?: Id<"personas">;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  includeReasoning?: boolean;
  reasoningEffort?: string;
  cachedSearchContext?: unknown;
  enabledIntegrations?: string[];
  subagentsEnabled?: boolean;
}

export async function updateSession(
  ctx: ActionCtx,
  sessionId: Id<"searchSessions">,
  patch: Record<string, unknown>,
): Promise<void> {
  await ctx.runMutation(internal.search.mutations.updateSearchSession, {
    sessionId,
    patch,
  });
}

/** M23: Schedule ancillary cost records for Perplexity search results. */
export async function trackPerplexitySearchCosts(
  ctx: ActionCtx,
  results: Array<{ success: boolean; usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cost?: number }; generationId?: string }>,
  attrs: {
    messageId: Id<"messages">;
    chatId: Id<"chats">;
    userId: string;
    searchModel: string;
  },
): Promise<void> {
  for (const r of results) {
    if (!r.success || !r.usage) continue;
    await ctx.scheduler.runAfter(0, internal.chat.mutations.storeAncillaryCost, {
      messageId: attrs.messageId,
      chatId: attrs.chatId,
      userId: attrs.userId,
      modelId: attrs.searchModel,
      promptTokens: r.usage.promptTokens,
      completionTokens: r.usage.completionTokens,
      totalTokens: r.usage.totalTokens,
      cost: r.usage.cost ?? undefined,
      source: "search_perplexity",
      generationId: r.generationId ?? undefined,
    });
  }
}
