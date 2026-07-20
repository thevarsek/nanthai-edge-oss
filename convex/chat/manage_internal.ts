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
 * Drain child rows left by a historical chat deletion. This refuses to run
 * while the parent chat still exists, so it cannot delete live chat data.
 */
export async function deleteDeletedChatResidueHandler(
  ctx: Parameters<typeof deleteChatGraph>[0],
  args: { chatId: Parameters<typeof deleteChatGraph>[1] },
): Promise<boolean> {
  if (await ctx.db.get(args.chatId)) return false;
  await deleteChatGraph(ctx, args.chatId, true);
  return true;
}

export const deleteDeletedChatResidue = internalMutation({
  args: { chatId: v.id("chats") },
  returns: v.boolean(),
  handler: deleteDeletedChatResidueHandler,
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
