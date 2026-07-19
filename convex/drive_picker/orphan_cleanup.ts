import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";

const BATCH_SIZE = 50;
const cleanupRef = makeFunctionReference<"mutation">(
  "drive_picker/orphan_cleanup:deleteDeletedParentBatches",
);

const activeStatusValidator = v.union(
  v.literal("awaiting_pick"),
  v.literal("resuming"),
);

export async function deleteDeletedParentBatchesHandler(
  ctx: MutationCtx,
  args: {
    status: "awaiting_pick" | "resuming";
    before: number;
    cursor?: string;
  },
) {
  const page = await ctx.db.query("drivePickerBatches")
    .withIndex("by_status_updated", (query) => query
      .eq("status", args.status)
      .lt("updatedAt", args.before))
    .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE });
  let deleted = 0;
  let retained = 0;
  for (const batch of page.page) {
    const [job, message, chat] = await Promise.all([
      ctx.db.get(batch.parentJobId),
      ctx.db.get(batch.parentMessageId),
      ctx.db.get(batch.chatId),
    ]);
    if (!job && !message && !chat && batch.updatedAt < args.before) {
      await ctx.db.delete(batch._id);
      deleted += 1;
    } else {
      retained += 1;
    }
  }
  if (!page.isDone) {
    await ctx.scheduler.runAfter(0, cleanupRef, {
      ...args,
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

export const deleteDeletedParentBatches = internalMutation({
  args: {
    status: activeStatusValidator,
    before: v.number(),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    scanned: v.number(),
    deleted: v.number(),
    retained: v.number(),
    continued: v.boolean(),
  }),
  handler: deleteDeletedParentBatchesHandler,
});
