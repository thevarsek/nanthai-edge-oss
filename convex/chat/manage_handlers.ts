import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth, requirePro } from "../lib/auth";
import { safeDeleteAudioBlob } from "./manage_delete_helpers";
import {
  copyChatParticipants,
  copyMessagesWithIdMap,
  copyNodePositions,
  loadAllChatMessages,
  loadMessagesForFork,
} from "./manage_copy_helpers";
import {
  areSiblingMessages,
  deriveCopiedChatMetadata,
  resolveSwitchedBranchLeaf,
} from "./manage_helpers";

export interface UpdateChatArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  title?: string;
  folderId?: string;
  isPinned?: boolean;
  mode?: "chat" | "ideascape";
  activeBranchLeafId?: Id<"messages">;
  subagentOverride?: "enabled" | "disabled" | null;
  temperatureOverride?: number | null;
  maxTokensOverride?: number | null;
  includeReasoningOverride?: boolean | null;
  reasoningEffortOverride?: string | null;
  autoAudioResponseOverride?: "enabled" | "disabled" | null;
  webSearchOverride?: boolean | null;
  searchModeOverride?: string | null;
  searchComplexityOverride?: number | null;
}

async function isSingleParticipantChat(
  ctx: MutationCtx,
  chatId: Id<"chats">,
): Promise<boolean> {
  const participants = await ctx.db
    .query("chatParticipants")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .collect();
  return participants.length <= 1;
}

async function resolveCopiedSubagentOverride(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  override: "enabled" | "disabled" | undefined,
): Promise<"enabled" | "disabled" | undefined> {
  if (override !== "enabled") {
    return override;
  }
  return await isSingleParticipantChat(ctx, chatId) ? "enabled" : undefined;
}

async function assertOwnedFolder(
  ctx: MutationCtx,
  userId: string,
  folderId: string | undefined,
): Promise<void> {
  if (!folderId) {
    return;
  }

  const folder = await ctx.db.get(folderId as Id<"folders">);
  if (!folder || folder.userId !== userId) {
    throw new Error("Folder not found or unauthorized");
  }
}

function resolveReasoningEffortOverride(
  includeReasoningOverride: boolean | null | undefined,
  reasoningEffortOverride: string | null | undefined,
): string | undefined {
  if (includeReasoningOverride === false) {
    return undefined;
  }
  if (reasoningEffortOverride === undefined || reasoningEffortOverride === null) {
    return undefined;
  }
  return reasoningEffortOverride;
}

/**
 * Returns true when the update only touches pin-related fields (isPinned).
 * Used to decide whether to bump `updatedAt` — pin/unpin is a display-layer
 * operation and should not push a chat to the top of the time-sorted list.
 */
export function isPinOnlyUpdate(args: UpdateChatArgs): boolean {
  return (
    args.isPinned !== undefined &&
    args.title === undefined &&
    args.folderId === undefined &&
    args.mode === undefined &&
    args.activeBranchLeafId === undefined &&
    args.subagentOverride === undefined &&
    args.temperatureOverride === undefined &&
    args.maxTokensOverride === undefined &&
    args.includeReasoningOverride === undefined &&
    args.reasoningEffortOverride === undefined &&
    args.webSearchOverride === undefined &&
    args.searchModeOverride === undefined &&
    args.searchComplexityOverride === undefined &&
    args.autoAudioResponseOverride === undefined
  );
}

/** Folder-only moves are organisational — don't bump updatedAt. */
export function isFolderOnlyUpdate(args: UpdateChatArgs): boolean {
  return (
    args.folderId !== undefined &&
    args.title === undefined &&
    args.isPinned === undefined &&
    args.mode === undefined &&
    args.activeBranchLeafId === undefined &&
    args.subagentOverride === undefined &&
    args.temperatureOverride === undefined &&
    args.maxTokensOverride === undefined &&
    args.includeReasoningOverride === undefined &&
    args.reasoningEffortOverride === undefined &&
    args.webSearchOverride === undefined &&
    args.searchModeOverride === undefined &&
    args.searchComplexityOverride === undefined &&
    args.autoAudioResponseOverride === undefined
  );
}

export async function updateChatHandler(
  ctx: MutationCtx,
  args: UpdateChatArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);
  const chat = await ctx.db.get(args.chatId);
  if (!chat || chat.userId !== userId) {
    throw new Error("Chat not found or unauthorized");
  }
  await assertOwnedFolder(ctx, userId, args.folderId);

  // Only bump updatedAt for content/structural changes (title, mode,
  // branch, subagent). Pin/unpin and folder moves are organisational
  // operations — bumping updatedAt would push the chat to the top of the
  // list unexpectedly.
  const isPinOnly = isPinOnlyUpdate(args);
  const isFolderOnly = isFolderOnlyUpdate(args);
  const skipTimestamp = isPinOnly || isFolderOnly;

  const patch: Record<string, unknown> = skipTimestamp
    ? {}
    : { updatedAt: Date.now() };
  if (args.title !== undefined) patch.title = args.title.trim() || chat.title;
  if (args.folderId !== undefined) patch.folderId = args.folderId || undefined;
  if (args.isPinned !== undefined) {
    patch.isPinned = args.isPinned;
    patch.pinnedAt = args.isPinned ? Date.now() : undefined;
  }
  if (args.mode !== undefined) patch.mode = args.mode;
  if (args.subagentOverride !== undefined) {
    if (args.subagentOverride === "enabled") {
      await requirePro(ctx, userId);
      if (!(await isSingleParticipantChat(ctx, args.chatId))) {
        throw new Error("Subagents are only available in single-model chats.");
      }
    }
    patch.subagentOverride = args.subagentOverride ?? undefined;
  }
  if (args.temperatureOverride !== undefined) {
    patch.temperatureOverride = args.temperatureOverride ?? undefined;
  }
  if (args.maxTokensOverride !== undefined) {
    patch.maxTokensOverride = args.maxTokensOverride ?? undefined;
  }
  if (args.includeReasoningOverride !== undefined) {
    patch.includeReasoningOverride = args.includeReasoningOverride ?? undefined;
    if (args.includeReasoningOverride === null || args.includeReasoningOverride === false) {
      patch.reasoningEffortOverride = undefined;
    }
  }
  if (args.reasoningEffortOverride !== undefined) {
    patch.reasoningEffortOverride = resolveReasoningEffortOverride(
      args.includeReasoningOverride,
      args.reasoningEffortOverride,
    );
  }
  if (args.webSearchOverride !== undefined) {
    patch.webSearchOverride = args.webSearchOverride ?? undefined;
  }
  if (args.searchModeOverride !== undefined) {
    patch.searchModeOverride = args.searchModeOverride ?? undefined;
  }
  if (args.searchComplexityOverride !== undefined) {
    patch.searchComplexityOverride = args.searchComplexityOverride ?? undefined;
  }
  if (args.autoAudioResponseOverride !== undefined) {
    patch.autoAudioResponseOverride = args.autoAudioResponseOverride ?? undefined;
  }
  if (args.activeBranchLeafId !== undefined) {
    const leaf = await ctx.db.get(args.activeBranchLeafId);
    if (!leaf || leaf.chatId !== args.chatId) {
      throw new Error("Active branch leaf must belong to the chat.");
    }
    patch.activeBranchLeafId = args.activeBranchLeafId;
  }

  await ctx.db.patch(args.chatId, patch);
}

export interface SwitchBranchAtForkArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  currentSiblingMessageId: Id<"messages">;
  targetSiblingMessageId: Id<"messages">;
}

export async function switchBranchAtForkHandler(
  ctx: MutationCtx,
  args: SwitchBranchAtForkArgs,
): Promise<Id<"messages">> {
  const { userId } = await requireAuth(ctx);
  const chat = await ctx.db.get(args.chatId);
  if (!chat || chat.userId !== userId) {
    throw new Error("Chat not found or unauthorized");
  }

  const messages = await loadAllChatMessages(ctx, args.chatId);
  const currentSibling = messages.find(
    (message: (typeof messages)[number]) => message._id === args.currentSiblingMessageId,
  );
  const targetSibling = messages.find(
    (message: (typeof messages)[number]) => message._id === args.targetSiblingMessageId,
  );
  if (!currentSibling || !targetSibling) {
    throw new Error("Branch message not found in chat");
  }
  if (!areSiblingMessages(currentSibling, targetSibling)) {
    throw new Error("Target message is not a sibling at the selected fork");
  }

  const nextLeafId = resolveSwitchedBranchLeaf({
    messages,
    activeBranchLeafId: chat.activeBranchLeafId as string | undefined,
    currentSiblingMessageId: args.currentSiblingMessageId as string,
    targetSiblingMessageId: args.targetSiblingMessageId as string,
  });
  if (!nextLeafId) {
    throw new Error("Unable to resolve branch leaf for selected fork");
  }

  await ctx.db.patch(args.chatId, {
    activeBranchLeafId: nextLeafId as Id<"messages">,
    updatedAt: Date.now(),
  });

  return nextLeafId as Id<"messages">;
}

export interface DeleteChatArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
}

export async function deleteChatHandler(
  ctx: MutationCtx,
  args: DeleteChatArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);
  const chat = await ctx.db.get(args.chatId);
  if (!chat || chat.userId !== userId) {
    throw new Error("Chat not found or unauthorized");
  }

  const deletingAt = Date.now();
  await ctx.db.patch(args.chatId, {
    isDeleting: true,
    deletingAt,
    updatedAt: deletingAt,
  });

  await ctx.scheduler.runAfter(0, internal.chat.manage_internal.deleteSingleChat, {
    chatId: args.chatId,
    userId,
  });
}

export interface BulkDeleteChatsArgs extends Record<string, unknown> {
  chatIds: Id<"chats">[];
}

export async function bulkDeleteChatsHandler(
  ctx: MutationCtx,
  args: BulkDeleteChatsArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);

  // P0-3: Schedule each chat deletion as a separate mutation to avoid
  // blowing Convex transaction limits when deleting many large chats.
  for (const chatId of args.chatIds) {
    const chat = await ctx.db.get(chatId);
    if (!chat || chat.userId !== userId) continue;
    await ctx.scheduler.runAfter(0, internal.chat.manage_internal.deleteSingleChat, {
      chatId,
      userId,
    });
  }
}

export interface BulkMoveChatsArgs extends Record<string, unknown> {
  chatIds: Id<"chats">[];
  folderId?: string;
}

export async function bulkMoveChatsHandler(
  ctx: MutationCtx,
  args: BulkMoveChatsArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);
  await assertOwnedFolder(ctx, userId, args.folderId);

  for (const chatId of args.chatIds) {
    const chat = await ctx.db.get(chatId);
    if (!chat || chat.userId !== userId) continue;

    // Folder moves are organisational — don't bump updatedAt,
    // consistent with isFolderOnlyUpdate() in updateChatHandler.
    await ctx.db.patch(chatId, {
      folderId: args.folderId || undefined,
    });
  }
}

export interface DeleteMessageArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
}

export async function deleteMessageHandler(
  ctx: MutationCtx,
  args: DeleteMessageArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);
  const message = await ctx.db.get(args.messageId);
  if (!message) {
    throw new Error("Message not found");
  }

  const chat = await ctx.db.get(message.chatId);
  if (!chat || chat.userId !== userId) {
    throw new Error("Unauthorized");
  }

  // Clean up audio storage blob — guarded to avoid destroying a blob still
  // referenced by a copied/forked chat.
  if (message.audioStorageId) {
    await safeDeleteAudioBlob(ctx, message.audioStorageId, message._id);
  }

  // Clean up generated files and their storage blobs
  const generatedFiles = await ctx.db
    .query("generatedFiles")
    .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
    .collect();
  for (const file of generatedFiles) {
    try {
      await ctx.storage.delete(file.storageId);
    } catch {
      // Storage blob may already be deleted — continue cleanup
    }
    await ctx.db.delete(file._id);
  }

  // Clean up generated charts
  const generatedCharts = await ctx.db
    .query("generatedCharts")
    .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
    .collect();
  for (const chart of generatedCharts) {
    await ctx.db.delete(chart._id);
  }

  // Clean up search context
  const searchContext = await ctx.db
    .query("searchContexts")
    .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
    .first();
  if (searchContext) {
    await ctx.db.delete(searchContext._id);
  }

  // Clean up search session and its child phases
  const searchSession = await ctx.db
    .query("searchSessions")
    .withIndex("by_message", (q) => q.eq("assistantMessageId", args.messageId))
    .first();
  if (searchSession) {
    const phases = await ctx.db
      .query("searchPhases")
      .withIndex("by_session", (q) => q.eq("sessionId", searchSession._id))
      .collect();
    for (const phase of phases) {
      await ctx.db.delete(phase._id);
    }
    await ctx.db.delete(searchSession._id);
  }

  const job = await ctx.db
    .query("generationJobs")
    .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
    .first();
  if (job) {
    await ctx.db.delete(job._id);
  }

  await ctx.db.delete(args.messageId);
}

export interface ForkChatArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  atMessageId: Id<"messages">;
}

export async function forkChatHandler(
  ctx: MutationCtx,
  args: ForkChatArgs,
): Promise<Id<"chats">> {
  const { userId } = await requireAuth(ctx);
  const chat = await ctx.db.get(args.chatId);
  if (!chat || chat.userId !== userId) {
    throw new Error("Chat not found or unauthorized");
  }

  const now = Date.now();
  const newChatId = await ctx.db.insert("chats", {
    userId,
    title: chat.title ? `${chat.title} (fork)` : "Forked conversation",
    mode: chat.mode,
    folderId: chat.folderId,
    subagentOverride: await resolveCopiedSubagentOverride(ctx, args.chatId, chat.subagentOverride),
    temperatureOverride: chat.temperatureOverride,
    maxTokensOverride: chat.maxTokensOverride,
    includeReasoningOverride: chat.includeReasoningOverride,
    reasoningEffortOverride: resolveReasoningEffortOverride(
      chat.includeReasoningOverride,
      chat.reasoningEffortOverride,
    ),
    autoAudioResponseOverride: chat.autoAudioResponseOverride,
    createdAt: now,
    updatedAt: now,
  });

  const forkMessages = await loadMessagesForFork(ctx, args.chatId, args.atMessageId);
  const { idMap, copiedMessages } = await copyMessagesWithIdMap(
    ctx,
    forkMessages,
    newChatId,
  );

  await copyChatParticipants(ctx, args.chatId, newChatId);
  await copyNodePositions(ctx, args.chatId, newChatId, userId, idMap);

  const forkLeafId = idMap.get(args.atMessageId as string) as
    | Id<"messages">
    | undefined;
  const metadata = deriveCopiedChatMetadata(copiedMessages, forkLeafId);
  await ctx.db.patch(newChatId, {
    updatedAt: now,
    messageCount: metadata.messageCount,
    activeBranchLeafId: metadata.activeBranchLeafId,
    lastMessageDate: metadata.lastMessageDate,
    lastMessagePreview: metadata.lastMessagePreview,
  });

  return newChatId;
}

export interface DuplicateChatArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
}

export interface ReorderPinnedChatsArgs extends Record<string, unknown> {
  orderedChatIds: Id<"chats">[];
}

export async function duplicateChatHandler(
  ctx: MutationCtx,
  args: DuplicateChatArgs,
): Promise<Id<"chats">> {
  const { userId } = await requireAuth(ctx);
  const chat = await ctx.db.get(args.chatId);
  if (!chat || chat.userId !== userId) {
    throw new Error("Chat not found or unauthorized");
  }

  const now = Date.now();
  const newChatId = await ctx.db.insert("chats", {
    userId,
    title: chat.title ? `${chat.title} (copy)` : "Copied conversation",
    mode: chat.mode,
    folderId: chat.folderId,
    subagentOverride: await resolveCopiedSubagentOverride(ctx, args.chatId, chat.subagentOverride),
    temperatureOverride: chat.temperatureOverride,
    maxTokensOverride: chat.maxTokensOverride,
    includeReasoningOverride: chat.includeReasoningOverride,
    reasoningEffortOverride: resolveReasoningEffortOverride(
      chat.includeReasoningOverride,
      chat.reasoningEffortOverride,
    ),
    autoAudioResponseOverride: chat.autoAudioResponseOverride,
    createdAt: now,
    updatedAt: now,
  });

  const messages = await loadAllChatMessages(ctx, args.chatId);
  const { idMap, copiedMessages } = await copyMessagesWithIdMap(
    ctx,
    messages,
    newChatId,
  );

  await copyChatParticipants(ctx, args.chatId, newChatId);
  await copyNodePositions(ctx, args.chatId, newChatId, userId, idMap);

  const mappedLeafId = chat.activeBranchLeafId
    ? (idMap.get(chat.activeBranchLeafId as string) as
      | Id<"messages">
      | undefined)
    : undefined;
  const metadata = deriveCopiedChatMetadata(copiedMessages, mappedLeafId);
  await ctx.db.patch(newChatId, {
    updatedAt: now,
    messageCount: metadata.messageCount,
    activeBranchLeafId: metadata.activeBranchLeafId,
    lastMessageDate: metadata.lastMessageDate,
    lastMessagePreview: metadata.lastMessagePreview,
  });

  return newChatId;
}

/**
 * Reorder pinned chats. Accepts the full ordered list of pinned chat IDs.
 * Assigns descending pinnedAt timestamps so the first ID in the array
 * appears at the top of the pinned section.
 */
export async function reorderPinnedChatsHandler(
  ctx: MutationCtx,
  args: ReorderPinnedChatsArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);
  const now = Date.now();

  for (let i = 0; i < args.orderedChatIds.length; i++) {
    const chat = await ctx.db.get(args.orderedChatIds[i]);
    if (!chat || chat.userId !== userId) {
      throw new Error("Chat not found or unauthorized");
    }
    if (!chat.isPinned) {
      throw new Error("Cannot reorder an unpinned chat");
    }
    // Descending pinnedAt: first item gets highest timestamp.
    // Pin reordering is a display-layer operation — don't bump updatedAt.
    await ctx.db.patch(args.orderedChatIds[i], {
      pinnedAt: now - i,
    });
  }
}
