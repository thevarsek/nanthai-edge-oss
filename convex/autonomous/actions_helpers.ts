import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { MODEL_IDS } from "../lib/model_constants";
import { callOpenRouterNonStreaming, OpenRouterMessage } from "../lib/openrouter";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";

export interface ParticipantConfig {
  participantId: string;
  modelId: string;
  personaId?: Id<"personas">;
  displayName: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  includeReasoning?: boolean;
  reasoningEffort?: string;
}

export interface ModeratorConfig {
  modelId: string;
  personaId?: Id<"personas">;
  displayName: string;
}

export function dedupeMessageIds(ids: Id<"messages">[]): Id<"messages">[] {
  const seen = new Set<Id<"messages">>();
  const deduped: Id<"messages">[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(id);
  }
  return deduped;
}

function buildRecentDiscussionSummary(
  messages: Array<{
    participantName?: string;
    modelId?: string;
    role: string;
    content: string;
  }>,
): string {
  return messages
    .map((message) => {
      const speaker =
        message.participantName ??
        message.modelId ??
        (message.role === "user" ? "User" : "Unknown");
      return `${speaker}: ${message.content}`;
    })
    .join("\n");
}

/**
 * Generate a moderator directive to guide the next participant's response.
 * Non-streaming call to a mid-tier model. Returns null on failure (non-fatal).
 */
export async function generateModeratorDirective(
  ctx: any,
  moderator: ModeratorConfig,
  nextParticipant: ParticipantConfig,
  chatId: Id<"chats">,
  userId: string,
): Promise<string | undefined> {
  try {
    const apiKey = await getRequiredUserOpenRouterApiKey(ctx, userId);
    let moderatorSystemPrompt: string | undefined;
    if (moderator.personaId) {
      const persona = await ctx.runQuery(internal.chat.queries.getPersona, {
        personaId: moderator.personaId,
        userId,
      });
      if (persona?.systemPrompt) {
        moderatorSystemPrompt = persona.systemPrompt.trim();
      }
    }

    const recentMessages = await ctx.runQuery(
      internal.autonomous.queries.recentMessages,
      { chatId, count: 5 },
    );
    const contextSummary = buildRecentDiscussionSummary(recentMessages);
    if (!contextSummary.trim()) return undefined;

    const prompt = `You are moderating a group discussion. The next participant to respond is "${nextParticipant.displayName}".

Recent discussion:
${contextSummary}

Generate a brief directive (1-2 sentences) to guide ${nextParticipant.displayName}'s response. Focus on: advancing the discussion, challenging weak arguments, exploring unexplored angles, or synthesizing points of agreement. Keep it under 50 words.`;

    const messages: OpenRouterMessage[] = [];
    if (moderatorSystemPrompt) {
      messages.push({
        role: "system",
        content: `You are ${moderator.displayName}, the moderator persona.\n\n${moderatorSystemPrompt}`,
      });
    }
    messages.push({ role: "user", content: prompt });

    const result = await callOpenRouterNonStreaming(
      apiKey,
      moderator.modelId,
      messages,
      { temperature: 0.7, maxTokens: 100 },
      { fallbackModel: MODEL_IDS.autonomousFallback },
    );

    const directive = result.content.trim();
    return directive || undefined;
  } catch (error) {
    console.error("Moderator directive generation failed:", error);
    return undefined;
  }
}

/**
 * Check whether participants have reached consensus by analyzing recent messages.
 * Uses a cheap model for cost-effective analysis. Returns true if consensus.
 */
export async function checkConsensusInternal(
  ctx: any,
  chatId: Id<"chats">,
  participantCount: number,
  userId: string,
): Promise<boolean> {
  try {
    const apiKey = await getRequiredUserOpenRouterApiKey(ctx, userId);
    const recentMessages = await ctx.runQuery(
      internal.autonomous.queries.recentMessages,
      { chatId, count: Math.max(participantCount, 3) },
    );

    const contextSummary = buildRecentDiscussionSummary(recentMessages);
    if (!contextSummary.trim()) return false;

    const prompt = `Are these participants reaching consensus or repeating each other's points? Answer YES or NO with a one-sentence explanation.

Recent discussion:
${contextSummary}`;

    const messages: OpenRouterMessage[] = [{ role: "user", content: prompt }];
    const result = await callOpenRouterNonStreaming(
      apiKey,
      MODEL_IDS.autonomousConsensus,
      messages,
      { temperature: 0.3, maxTokens: 50 },
      { fallbackModel: MODEL_IDS.autonomousFallback },
    );

    const normalized = result.content.trim().toUpperCase();
    return normalized.startsWith("YES");
  } catch (error) {
    console.error("Consensus check failed:", error);
    return false;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
