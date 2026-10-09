import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { ListChatsArgs } from "./queries_handlers_public";

/** Creation-ordered choices; sidebar pin/update ordering remains unchanged. */
export async function listCreatedChats(ctx: QueryCtx, userId: string, args: ListChatsArgs, limit: number) {
  const before = args.beforeChatId ? await ctx.db.get(args.beforeChatId) : null;
  if (args.beforeChatId && (!before || before.userId !== userId)) return [];
  const search = args.searchQuery?.trim() ?? "";
  let rows: Doc<"chats">[];
  if (search) {
    // Search the owned history, including conversations outside the current page.
    const [titles, previews] = await Promise.all([
      ctx.db.query("chats").withSearchIndex("search_title", q => q.search("title", search).eq("userId", userId)).take(500),
      ctx.db.query("chats").withSearchIndex("search_preview", q => q.search("lastMessagePreview", search).eq("userId", userId)).take(500),
    ]);
    rows = [...new Map([...titles, ...previews].map(row => [row._id, row])).values()];
  } else {
    rows = await ctx.db.query("chats").withIndex("by_user_created", q => {
      const owned = q.eq("userId", userId);
      return before ? owned.lte("createdAt", before.createdAt) : owned;
    }).order("desc").filter(q => q.and(
      q.neq(q.field("isDeleting"), true),
      before ? q.or(q.lt(q.field("createdAt"), before.createdAt),
        q.lt(q.field("_creationTime"), before._creationTime)) : true,
    )).take(limit);
  }
  return rows.filter(row => row.isDeleting !== true
    && (!args.folderId || row.folderId === args.folderId)
    && (!args.source || (row.source ?? "user") === args.source)
    && (!before || row.createdAt < before.createdAt
      || (row.createdAt === before.createdAt && row._creationTime < before._creationTime)))
    .sort((a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime).slice(0, limit);
}
