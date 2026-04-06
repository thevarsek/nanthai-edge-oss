import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { ActionCtx } from "../_generated/server";
import { GenerationCancelledError } from "../chat/generation_helpers";

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
  subagentsEnabled?: boolean;
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
