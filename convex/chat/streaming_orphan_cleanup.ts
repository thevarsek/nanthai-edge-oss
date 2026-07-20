import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { isTerminalMessageStatus } from "./streaming_state";

const PAGE_SIZE = 100;
const cleanupRef = makeFunctionReference<"mutation">(
  "chat/streaming_orphan_cleanup:cleanOrphanedStreamingMessages",
);

export interface CleanOrphanedStreamingMessagesArgs {
  before: number;
  cursor?: string;
}

/** Remove stale projections that no active or visible message can consume. */
export async function cleanOrphanedStreamingMessagesHandler(
  ctx: MutationCtx,
  args: CleanOrphanedStreamingMessagesArgs,
) {
  const page = await ctx.db
    .query("streamingMessages")
    .paginate({
      cursor: args.cursor ?? null,
      numItems: PAGE_SIZE,
      maximumRowsRead: PAGE_SIZE,
    });
  let deleted = 0;
  let retained = 0;
  for (const streaming of page.page) {
    const message = await ctx.db.get(streaming.messageId);
    const unowned = !message || isTerminalMessageStatus(message.status);
    if (unowned && streaming.updatedAt < args.before) {
      await ctx.db.delete(streaming._id);
      deleted += 1;
    } else {
      retained += 1;
    }
  }
  if (!page.isDone) {
    await ctx.scheduler.runAfter(0, cleanupRef, {
      before: args.before,
      cursor: page.continueCursor,
    });
  }
  return {
    scanned: page.page.length,
    deleted,
    retained,
    continued: !page.isDone,
  };
}

export const cleanOrphanedStreamingMessages = internalMutation({
  args: {
    before: v.number(),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    scanned: v.number(),
    deleted: v.number(),
    retained: v.number(),
    continued: v.boolean(),
  }),
  handler: cleanOrphanedStreamingMessagesHandler,
});

export const cleanOrphanedStreamingMessagesCron = internalMutation({
  args: {},
  returns: v.object({
    scanned: v.number(),
    deleted: v.number(),
    retained: v.number(),
    continued: v.boolean(),
  }),
  handler: async (ctx) => await cleanOrphanedStreamingMessagesHandler(ctx, {
    before: Date.now() - 60 * 60 * 1_000,
  }),
});
