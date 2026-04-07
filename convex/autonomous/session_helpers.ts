import { ConvexError } from "convex/values";
import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

export interface ParticipantConfigInput {
  participantId: string;
}

export function dedupeParticipantIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

export function assertTurnConfiguration(
  turnOrder: string[],
  participantConfigs: ParticipantConfigInput[],
  moderatorParticipantId?: string,
): void {
  const uniqueTurnOrder = dedupeParticipantIds(turnOrder);
  if (uniqueTurnOrder.length < 2) {
    throw new ConvexError({ code: "VALIDATION", message: "Autonomous mode requires at least 2 active turn-takers" });
  }
  if (
    moderatorParticipantId &&
    uniqueTurnOrder.includes(moderatorParticipantId)
  ) {
    throw new ConvexError({ code: "VALIDATION", message: "Moderator cannot also be in autonomous turn order" });
  }
  const configuredParticipantIds = new Set(
    participantConfigs.map((config) => config.participantId),
  );
  for (const participantId of uniqueTurnOrder) {
    if (!configuredParticipantIds.has(participantId)) {
      throw new ConvexError({ code: "VALIDATION", message: `Missing participant config for turn-taker: ${participantId}` });
    }
  }
}

export function computeResumeCursor(
  currentCycle: number,
  currentParticipantIndex: number | undefined,
  turnTakerCount: number,
): { resumeCycle: number; startParticipantIndex: number } {
  const safeTurnTakerCount = Math.max(1, turnTakerCount);
  const normalizedCycle = Math.max(1, Math.floor(currentCycle));
  const completedIndex =
    currentParticipantIndex !== undefined
      ? Math.floor(currentParticipantIndex)
      : -1;

  let resumeCycle = normalizedCycle;
  let startParticipantIndex = Math.max(0, completedIndex + 1);

  if (startParticipantIndex >= safeTurnTakerCount) {
    resumeCycle = normalizedCycle + 1;
    startParticipantIndex = 0;
  }

  return { resumeCycle, startParticipantIndex };
}

export async function resolveInitialParentMessageIds(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  activeBranchLeafId?: Id<"messages">,
): Promise<Id<"messages">[]> {
  const latestMessages = await ctx.db
    .query("messages")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .order("desc")
    .take(1);

  const activeLeaf = activeBranchLeafId
    ? await ctx.db.get(activeBranchLeafId)
    : null;
  const anchorMessage =
    activeLeaf && activeLeaf.chatId === chatId
      ? activeLeaf
      : (latestMessages[0] ?? null);

  const parentMessageIds: Id<"messages">[] = [];
  if (!anchorMessage) {
    return parentMessageIds;
  }

  if (!anchorMessage.multiModelGroupId) {
    parentMessageIds.push(anchorMessage._id);
    return parentMessageIds;
  }

  const allChatMessages = await ctx.db
    .query("messages")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .collect();
  const siblingIDs = allChatMessages
    .filter(
      (message) => message.multiModelGroupId === anchorMessage.multiModelGroupId,
    )
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((message) => message._id);

  const ordered = [
    anchorMessage._id,
    ...siblingIDs.filter((id) => id !== anchorMessage._id),
  ];
  const seen = new Set<Id<"messages">>();
  for (const id of ordered) {
    if (seen.has(id)) continue;
    seen.add(id);
    parentMessageIds.push(id);
  }

  return parentMessageIds;
}

export async function cancelInFlightAutonomousTurns(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  turnOrder: string[],
): Promise<void> {
  const now = Date.now();
  const turnOrderSet = new Set(turnOrder);
  const activeJobs = await ctx.db
    .query("generationJobs")
    .withIndex("by_chat_status", (query) =>
      query.eq("chatId", chatId).eq("status", "streaming"),
    )
    .collect();
  const queuedJobs = await ctx.db
    .query("generationJobs")
    .withIndex("by_chat_status", (query) =>
      query.eq("chatId", chatId).eq("status", "queued"),
    )
    .collect();

  for (const job of [...activeJobs, ...queuedJobs]) {
    const message = await ctx.db.get(job.messageId);
    if (!message) continue;
    if (!message.autonomousParticipantId || !turnOrderSet.has(message.autonomousParticipantId)) {
      continue;
    }

    await ctx.db.patch(job._id, {
      status: "cancelled",
      completedAt: now,
    });

    if (message.status === "pending" || message.status === "streaming") {
      await ctx.db.patch(message._id, {
        status: "cancelled",
        content: "",
      });
    }
  }

  const pendingMessages = await ctx.db
    .query("messages")
    .withIndex("by_chat_status", (query) =>
      query.eq("chatId", chatId).eq("status", "pending"),
    )
    .collect();
  const streamingMessages = await ctx.db
    .query("messages")
    .withIndex("by_chat_status", (query) =>
      query.eq("chatId", chatId).eq("status", "streaming"),
    )
    .collect();

  for (const message of [...pendingMessages, ...streamingMessages]) {
    if (!message.autonomousParticipantId || !turnOrderSet.has(message.autonomousParticipantId)) {
      continue;
    }
    await ctx.db.patch(message._id, {
      status: "cancelled",
      content: "",
    });
  }
}
