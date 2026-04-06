import { v, type PropertyValidators } from "convex/values";

export const updateChatArgs = {
  chatId: v.id("chats"),
  title: v.optional(v.string()),
  folderId: v.optional(v.string()),
  isPinned: v.optional(v.boolean()),
  mode: v.optional(v.union(v.literal("chat"), v.literal("ideascape"))),
  activeBranchLeafId: v.optional(v.id("messages")),
  subagentOverride: v.optional(v.union(
    v.literal("enabled"),
    v.literal("disabled"),
    v.null(),
  )),
  temperatureOverride: v.optional(v.union(v.number(), v.null())),
  maxTokensOverride: v.optional(v.union(v.number(), v.null())),
  includeReasoningOverride: v.optional(v.union(v.boolean(), v.null())),
  reasoningEffortOverride: v.optional(v.union(v.string(), v.null())),
  // Per-chat internet search overrides (null = clear override, use global default)
  webSearchOverride: v.optional(v.union(v.boolean(), v.null())),
  searchModeOverride: v.optional(v.union(v.string(), v.null())),
  searchComplexityOverride: v.optional(v.union(v.number(), v.null())),
  autoAudioResponseOverride: v.optional(v.union(
    v.literal("enabled"),
    v.literal("disabled"),
    v.null(),
  )),
} satisfies PropertyValidators;

export const switchBranchAtForkArgs = {
  chatId: v.id("chats"),
  currentSiblingMessageId: v.id("messages"),
  targetSiblingMessageId: v.id("messages"),
} satisfies PropertyValidators;

export const deleteChatArgs = {
  chatId: v.id("chats"),
} satisfies PropertyValidators;

export const bulkDeleteChatsArgs = {
  chatIds: v.array(v.id("chats")),
} satisfies PropertyValidators;

export const bulkMoveChatsArgs = {
  chatIds: v.array(v.id("chats")),
  folderId: v.optional(v.string()),
} satisfies PropertyValidators;

export const deleteMessageArgs = {
  messageId: v.id("messages"),
} satisfies PropertyValidators;

export const forkChatArgs = {
  chatId: v.id("chats"),
  atMessageId: v.id("messages"),
} satisfies PropertyValidators;

export const duplicateChatArgs = {
  chatId: v.id("chats"),
} satisfies PropertyValidators;

export const reorderPinnedChatsArgs = {
  orderedChatIds: v.array(v.id("chats")),
} satisfies PropertyValidators;
