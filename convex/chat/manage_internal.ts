// convex/chat/manage_internal.ts
// =============================================================================
// Internal mutations for chat management (batched delete continuations, etc.).
// =============================================================================

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { deleteChatGraph } from "./manage_delete_helpers";

/**
 * Continuation mutation for batched chat deletion.
 * Called by `deleteChatGraph` when a single pass didn't drain all child rows.
 * Re-enters `deleteChatGraph` which will process another batch and
 * self-schedule again if needed.
 */
export const deleteChatContinuation = internalMutation({
  args: { chatId: v.id("chats") },
  handler: async (ctx, args) => {
    // Verify the chat still exists (may have been fully deleted in a prior pass)
    const chat = await ctx.db.get(args.chatId);
    if (!chat) return;

    await deleteChatGraph(ctx, args.chatId);
  },
});

/**
 * Delete a single chat — called by bulkDeleteChats scheduler.
 * Ownership was already verified by the parent mutation; this just
 * does a final existence check and delegates to deleteChatGraph.
 */
export const deleteSingleChat = internalMutation({
  args: { chatId: v.id("chats"), userId: v.string() },
  handler: async (ctx, args) => {
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== args.userId) return;

    await deleteChatGraph(ctx, args.chatId);
  },
});
