import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { ActionCtx } from "../_generated/server";
import { GenerationCancelledError } from "../chat/generation_helpers";
import type { AnalyticsClientMetadata } from "../analytics/client_metadata";
import type { GenerationAnalyticsSource } from "../chat/actions_run_generation_types";
import { normalizeGenerationError } from "../chat/generation_error";

export interface PipelineArgs extends Record<string, unknown> {
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
  enabledIntegrations?: string[];
  turnIntegrationOverrides?: Array<{ integrationId: string; enabled: boolean }>;
  subagentsEnabled?: boolean;
  analytics?: AnalyticsClientMetadata;
  analyticsSource?: GenerationAnalyticsSource;
}

export async function checkCancellation(
  ctx: ActionCtx,
  sessionId: Id<"searchSessions">,
): Promise<void> {
  const session = await ctx.runQuery(internal.search.queries.getSearchSession, {
    sessionId,
  });
  if (session?.status === "cancelled") {
    throw new GenerationCancelledError();
  }
}

/**
 * Clamp enabled reasoning to the smallest OpenRouter effort for paper-style
 * paths that intentionally permit reasoning. The main research-paper pipeline
 * keeps reasoning disabled across synthesis, architecture, and drafting.
 */
export function clampResearchPaperReasoningEffort(
  includeReasoning?: boolean | null,
  reasoningEffort?: string | null,
): string | null {
  if (includeReasoning === false) return null;
  if (!reasoningEffort && includeReasoning !== true) return null;
  if (reasoningEffort === "none") return "none";
  return "minimal";
}

export function formatResearchPaperFailureMessage(error: unknown): string {
  const rawMessage = normalizeGenerationError(error).message;
  const lower = rawMessage.toLowerCase();
  if (
    lower.includes("openrouter non-stream timeout") ||
    lower.includes("openrouter stream timeout") ||
    lower.includes("perplexity search timeout") ||
    lower.includes("aborterror")
  ) {
    return "The model did not finish in time (timeout) while preparing the research paper. Please retry or choose a faster model.";
  }
  return rawMessage;
}

export function computeProgress(
  complexity: number,
  phase: string,
  iteration: number,
): number {
  if (complexity === 1) {
    switch (phase) {
      case "planning": return 25;
      case "initial_search": return 50;
      case "synthesis": return 75;
      case "paper": return 90;
      default: return 0;
    }
  }

  if (complexity === 2) {
    switch (phase) {
      case "planning": return 10;
      case "initial_search": return 25;
      case "analysis": return 40;
      case "depth_iteration": return 55;
      case "synthesis": return 75;
      case "paper": return 90;
      default: return 0;
    }
  }

  switch (phase) {
    case "planning": return 8;
    case "initial_search": return 20;
    case "analysis":
      return iteration === 0 ? 30 : 54;
    case "depth_iteration":
      return iteration === 0 ? 42 : 66;
    case "synthesis": return 80;
    case "paper": return 90;
    default: return 0;
  }
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
