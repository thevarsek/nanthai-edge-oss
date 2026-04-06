// convex/chat/manage.ts
// =============================================================================
// Stable chat management mutation registrations.
// =============================================================================

import { mutation } from "../_generated/server";
import { v } from "convex/values";
import {
  bulkDeleteChatsArgs,
  bulkMoveChatsArgs,
  deleteChatArgs,
  deleteMessageArgs,
  duplicateChatArgs,
  forkChatArgs,
  reorderPinnedChatsArgs,
  switchBranchAtForkArgs,
  updateChatArgs,
} from "./manage_args";
import {
  bulkDeleteChatsHandler,
  bulkMoveChatsHandler,
  deleteChatHandler,
  deleteMessageHandler,
  duplicateChatHandler,
  forkChatHandler,
  reorderPinnedChatsHandler,
  switchBranchAtForkHandler,
  updateChatHandler,
} from "./manage_handlers";

export const updateChat = mutation({
  args: updateChatArgs,
  handler: updateChatHandler,
});

export const switchBranchAtFork = mutation({
  args: switchBranchAtForkArgs,
  returns: v.id("messages"),
  handler: switchBranchAtForkHandler,
});

export const deleteChat = mutation({
  args: deleteChatArgs,
  handler: deleteChatHandler,
});

export const bulkDeleteChats = mutation({
  args: bulkDeleteChatsArgs,
  handler: bulkDeleteChatsHandler,
});

export const bulkMoveChats = mutation({
  args: bulkMoveChatsArgs,
  handler: bulkMoveChatsHandler,
});

export const deleteMessage = mutation({
  args: deleteMessageArgs,
  handler: deleteMessageHandler,
});

export const forkChat = mutation({
  args: forkChatArgs,
  returns: v.id("chats"),
  handler: forkChatHandler,
});

export const duplicateChat = mutation({
  args: duplicateChatArgs,
  returns: v.id("chats"),
  handler: duplicateChatHandler,
});

export const reorderPinnedChats = mutation({
  args: reorderPinnedChatsArgs,
  handler: reorderPinnedChatsHandler,
});
