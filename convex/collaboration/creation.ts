import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { SendParticipantConfig } from "../chat/mutation_send_helpers";
import {
  ACTIVE_COLLABORATION_STATUSES,
  COLLABORATION_MAX_DURATION_MS,
  COLLABORATION_MAX_PARTICIPANT_MESSAGES,
  COLLABORATION_MAX_WAVES,
  COLLABORATION_POLICY_VERSION,
  COLLABORATION_SCHEDULER_VERSION,
} from "./constants";
import type {
  CollaborationGenerationSnapshot,
  CollaborationParticipantSnapshot,
} from "./validators";

function displayName(participant: Doc<"chatParticipants">): string {
  const personaName = participant.personaName?.trim();
  if (personaName) return personaName;
  return participant.modelId.split("/").pop()?.replaceAll("-", " ")
    ?? participant.modelId;
}

export async function findActiveCollaborationExchange(
  ctx: MutationCtx,
  chatId: Id<"chats">,
): Promise<Doc<"collaborationExchanges"> | null> {
  const recent = await ctx.db
    .query("collaborationExchanges")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .order("desc")
    .take(5);
  return recent.find((exchange) =>
    ACTIVE_COLLABORATION_STATUSES.has(
      exchange.status as "queued" | "scheduling" | "dispatching" | "waiting",
    )
  ) ?? null;
}

async function resolveParticipantSnapshot(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  userId: string,
  requested: SendParticipantConfig[],
): Promise<CollaborationParticipantSnapshot[]> {
  const rows = await ctx.db
    .query("chatParticipants")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .collect();
  const requestedKeys = new Set(
    requested.flatMap((participant) =>
      participant.participantKey ? [participant.participantKey] : []
    ),
  );
  const selectedRows = requestedKeys.size > 0
    ? rows.filter((row) => requestedKeys.has(String(row._id)))
    : rows.filter((row) => requested.some((participant) =>
      participant.modelId === row.modelId &&
      String(participant.personaId ?? "") === String(row.personaId ?? "")
    ));
  if (
    selectedRows.length !== requested.length ||
    selectedRows.some((row) => row.userId !== userId)
  ) {
    throw new ConvexError({
      code: "VALIDATION",
      message: "The chat participants changed. Refresh the chat and try again.",
    });
  }
  return selectedRows
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((row) => ({
      participantId: row._id,
      modelId: row.modelId,
      personaId: row.personaId,
      displayName: displayName(row),
      personaEmoji: row.personaEmoji,
      personaAvatarImageUrl: row.personaAvatarImageUrl,
      temperature: row.temperature,
      maxTokens: row.maxTokens,
      includeReasoning: row.includeReasoning,
      reasoningEffort: row.reasoningEffort,
    }));
}

export function resolveMentionedParticipantIds(
  snapshot: CollaborationParticipantSnapshot[],
  mentionedKeys: string[] | undefined,
): Id<"chatParticipants">[] {
  if (!mentionedKeys?.length) return [];
  const available = new Set(snapshot.map((participant) =>
    String(participant.participantId)
  ));
  const unique = new Set(mentionedKeys);
  if (
    unique.size !== mentionedKeys.length ||
    mentionedKeys.some((key) => !available.has(key))
  ) {
    throw new ConvexError({
      code: "VALIDATION",
      message: "A mentioned participant is no longer available. Refresh the chat and try again.",
    });
  }
  return mentionedKeys as Id<"chatParticipants">[];
}

export async function createCollaborationExchange(
  ctx: MutationCtx,
  args: {
    userId: string;
    chatId: Id<"chats">;
    initiatingMessageId: Id<"messages">;
    participants: SendParticipantConfig[];
    mentionedParticipantKeys?: string[];
    generationSnapshot: CollaborationGenerationSnapshot;
    now: number;
  },
): Promise<Id<"collaborationExchanges">> {
  const snapshot = await resolveParticipantSnapshot(
    ctx,
    args.chatId,
    args.userId,
    args.participants,
  );
  if (snapshot.length < 2) {
    throw new ConvexError({
      code: "VALIDATION",
      message: "Collaboration needs at least two chat participants.",
    });
  }
  const mentionedParticipantIds = resolveMentionedParticipantIds(
    snapshot,
    args.mentionedParticipantKeys,
  );
  return await ctx.db.insert("collaborationExchanges", {
    userId: args.userId,
    chatId: args.chatId,
    initiatingMessageId: args.initiatingMessageId,
    participantSnapshot: snapshot,
    mentionedParticipantIds,
    pendingMentionedParticipantIds: [],
    generationSnapshot: args.generationSnapshot,
    policyVersion: COLLABORATION_POLICY_VERSION,
    schedulerVersion: COLLABORATION_SCHEDULER_VERSION,
    status: "queued",
    currentWave: 0,
    publishedMessageCount: 0,
    frontierMessageIds: [args.initiatingMessageId],
    pendingHumanMessageIds: [],
    activeParticipantIds: [],
    failedParticipantIds: [],
    bounds: {
      maxWaves: COLLABORATION_MAX_WAVES,
      maxParticipantMessages: COLLABORATION_MAX_PARTICIPANT_MESSAGES,
      deadlineAt: args.now + COLLABORATION_MAX_DURATION_MS,
    },
    createdAt: args.now,
    updatedAt: args.now,
  });
}

export async function joinActiveCollaborationExchange(
  ctx: MutationCtx,
  exchange: Doc<"collaborationExchanges">,
  messageId: Id<"messages">,
  mentionedParticipantKeys: string[] | undefined,
  now: number,
): Promise<void> {
  if (exchange.pendingHumanMessageIds.includes(messageId)) return;
  await ctx.db.patch(exchange._id, {
    pendingHumanMessageIds: [...exchange.pendingHumanMessageIds, messageId],
    pendingMentionedParticipantIds: [
      ...exchange.pendingMentionedParticipantIds,
      ...resolveMentionedParticipantIds(
        exchange.participantSnapshot,
        mentionedParticipantKeys,
      ).filter((participantId) =>
        !exchange.pendingMentionedParticipantIds.includes(participantId)
      ),
    ],
    updatedAt: now,
  });
  await ctx.db.patch(messageId, { collaborationExchangeId: exchange._id });
}
