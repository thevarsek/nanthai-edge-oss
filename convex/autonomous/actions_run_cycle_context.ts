import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { ParticipantConfig } from "./actions_helpers";
import {
  ModelCapabilities,
  NormalizedRunCycleArgs,
  RunCycleArgs,
} from "./actions_run_cycle_types";
import { resolveMemoryContextForGeneration } from "../chat/action_memory_helpers";

export function normalizeRunCycleArgs(args: RunCycleArgs): NormalizedRunCycleArgs {
  const participants: ParticipantConfig[] = args.participantConfigs.map(
    (participant) => ({
      participantId: participant.participantId,
      modelId: participant.modelId,
      personaId: participant.personaId ?? undefined,
      displayName: participant.displayName,
      systemPrompt: participant.systemPrompt ?? undefined,
      temperature: participant.temperature,
      maxTokens: participant.maxTokens,
      includeReasoning: participant.includeReasoning,
      reasoningEffort: participant.reasoningEffort ?? undefined,
    }),
  );

  const moderator = args.moderatorConfig
    ? {
        modelId: args.moderatorConfig.modelId,
        personaId: args.moderatorConfig.personaId ?? undefined,
        displayName: args.moderatorConfig.displayName,
      }
    : undefined;

  return { participants, moderator };
}

export function resolveTurnParticipants(
  turnOrder: string[],
  normalizedParticipants: ParticipantConfig[],
): ParticipantConfig[] {
  const participantConfigsById = new Map(
    normalizedParticipants.map((participant) => [
      participant.participantId,
      participant,
    ]),
  );

  return turnOrder
    .map((participantId) => participantConfigsById.get(participantId))
    .filter((participant): participant is ParticipantConfig => participant !== undefined);
}

export function resolveStartParticipantIndex(
  startParticipantIndex: number | undefined,
  turnParticipantsLength: number,
): number {
  const requestedStartIndex = Math.max(0, Math.floor(startParticipantIndex ?? 0));
  return Math.min(requestedStartIndex, turnParticipantsLength);
}

/**
 * Autonomous turns are intentionally linear: each turn should anchor to a
 * single parent message even if the initial session seed had multiple IDs.
 */
export function resolveLinearCycleParentIds(
  sessionParentMessageIds: Id<"messages">[],
): Id<"messages">[] {
  if (sessionParentMessageIds.length === 0) {
    return [];
  }
  return [sessionParentMessageIds[0]];
}

export async function loadMemoryContext(
  ctx: ActionCtx,
  userId: string,
  personaId?: Id<"personas">,
  chatId?: Id<"chats">,
): Promise<string | undefined> {
  if (!chatId) return undefined;
  const rawMessages = await ctx.runQuery(internal.chat.queries.listAllMessages, { chatId });
  const lastUserMessage = rawMessages
    .slice()
    .reverse()
    .find((message) => message.role === "user");
  if (!lastUserMessage) return undefined;
  return resolveMemoryContextForGeneration(ctx, {
    messages: rawMessages.map((message) => ({
      _id: message._id,
      role: message.role,
      content: message.content,
    })),
    userMessageId: lastUserMessage._id,
    userId,
    personaId,
  });
}

export async function loadModelCapabilities(
  ctx: ActionCtx,
  participants: ParticipantConfig[],
): Promise<Map<string, ModelCapabilities>> {
  const modelCapabilities = new Map<string, ModelCapabilities>();

  for (const participant of participants) {
    if (!modelCapabilities.has(participant.modelId)) {
      const caps = await ctx.runQuery(internal.chat.queries.getModelCapabilities, {
        modelId: participant.modelId,
      });
      if (caps) modelCapabilities.set(participant.modelId, caps);
    }
  }

  return modelCapabilities;
}
