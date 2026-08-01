import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requirePro } from "../lib/auth";

const MAX_CONTEXT_INVOCATIONS = 8;

export async function resolveMessageMcpInvocations(
  ctx: MutationCtx,
  userId: string,
  chatId: Id<"chats">,
  publicIds: string[] | undefined,
): Promise<Id<"mcpInvocations">[]> {
  const requested = [...new Set((publicIds ?? []).filter(Boolean))];
  if (requested.length === 0) return [];
  await requirePro(ctx, userId);
  if (requested.length > MAX_CONTEXT_INVOCATIONS) {
    throw new ConvexError({ code: "MCP_CONTEXT_LIMIT", message: "Attach up to 8 Remote MCP items." });
  }
  const ids: Id<"mcpInvocations">[] = [];
  for (const publicId of requested) {
    const invocation = await ctx.db
      .query("mcpInvocations")
      .withIndex("by_user_public_id", (q) => q.eq("userId", userId).eq("publicId", publicId))
      .unique();
    if (
      !invocation
      || invocation.state !== "completed"
      || invocation.kind === "tool"
      || invocation.messageId
      || invocation.chatId !== chatId
    ) {
      throw new ConvexError({
        code: "MCP_CONTEXT_UNAVAILABLE",
        message: "A selected Remote MCP prompt or resource is no longer available.",
      });
    }
    const connection = await ctx.db.get(invocation.connectionId);
    const legacyItem = !invocation.catalogStableKey && invocation.catalogItemId
      ? await ctx.db.get(invocation.catalogItemId)
      : null;
    const stableKey = invocation.catalogStableKey ?? legacyItem?.stableKey;
    const item = stableKey
      ? await ctx.db
          .query("mcpCatalogItems")
          .withIndex("by_stable_key", (query) => query
            .eq("connectionId", invocation.connectionId)
            .eq("stableKey", stableKey))
          .unique()
      : null;
    if (
      !connection
      || connection.userId !== userId
      || connection.status !== "active"
      || !item
      || item.userId !== userId
      || item.decision !== "allowed"
    ) {
      throw new ConvexError({
        code: "MCP_CONTEXT_DISABLED",
        message: "A selected Remote MCP server or item has been disabled.",
      });
    }
    ids.push(invocation._id);
  }
  return ids;
}

export async function linkMessageMcpInvocations(
  ctx: MutationCtx,
  ids: Id<"mcpInvocations">[],
  messageId: Id<"messages">,
  chatId: Id<"chats">,
): Promise<void> {
  for (const invocationId of ids) {
    await ctx.db.patch(invocationId, { messageId, chatId, updatedAt: Date.now() });
  }
}
