import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";

// Maximum documents to scan per transaction to stay well within Convex limits.
const BATCH_SIZE = 200;

function isPersonaDocument(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return "systemPrompt" in value && "userId" in value;
}

/**
 * Safe migration: scans messages OR searchSessions in batches, nulls out
 * invalid participantId references (instead of deleting entire chats).
 *
 * Convex only allows one paginated query per mutation, so pass
 * table: "messages" or table: "searchSessions" to select which to process.
 * Run each table separately, looping with cursor until isComplete is true.
 *
 * Set dryRun: true to preview what would be repaired without making changes.
 */
export const repairInvalidMessagePersonas = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    table: v.optional(v.string()),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    repairedCount: v.number(),
    scannedCount: v.number(),
    isComplete: v.boolean(),
    nextCursor: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const table = args.table ?? "messages";
    let repairedCount = 0;

    if (table === "messages") {
      const page = await ctx.db
        .query("messages")
        .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE });

      for (const message of page.page) {
        if (!message.participantId) continue;
        const ref = await ctx.db.get(message.participantId as Id<"personas">);
        if (isPersonaDocument(ref)) continue;
        // Invalid reference — this participantId is not a valid persona doc.
        // Before the autonomousParticipantId field was added, autonomous writes
        // stored the participant string (e.g. "participant_1") directly in
        // participantId (which was typed as v.string() at that time). Backfill
        // autonomousParticipantId from the old value if it hasn't been set yet,
        // then null out participantId so it no longer points at a missing doc.
        repairedCount += 1;
        if (!dryRun) {
          const patch: Record<string, unknown> = { participantId: undefined };
          if (
            !(message as any).autonomousParticipantId &&
            typeof message.participantId === "string"
          ) {
            patch.autonomousParticipantId = message.participantId as string;
          }
          await ctx.db.patch(message._id, patch as any);
        }
      }

      return {
        repairedCount,
        scannedCount: page.page.length,
        isComplete: page.isDone,
        nextCursor: page.isDone ? undefined : page.continueCursor,
      };
    }

    // --- searchSessions ---
    const page = await ctx.db
      .query("searchSessions")
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE });

    for (const session of page.page) {
      if (!session.participantId) continue;
      const ref = await ctx.db.get(session.participantId);
      if (isPersonaDocument(ref)) continue;
      repairedCount += 1;
      if (!dryRun) {
        await ctx.db.patch(session._id, { participantId: undefined });
      }
    }

    return {
      repairedCount,
      scannedCount: page.page.length,
      isComplete: page.isDone,
      nextCursor: page.isDone ? undefined : page.continueCursor,
    };
  },
});

/**
 * One-time backfill: stamps userId onto memoryEmbeddings rows that were
 * inserted before the userId field was added to the schema.
 *
 * Works in batches of BATCH_SIZE. Caller must page through by passing the
 * returned cursor until isComplete is true.
 *
 * Set dryRun: true to preview how many rows would be patched.
 *
 * Returns:
 *   - patchedCount: rows updated in this batch
 *   - skippedCount: rows that already had userId (no-op)
 *   - scannedCount: total rows examined in this batch
 *   - isComplete: false when more rows remain (pass cursor and run again)
 *   - nextCursor: cursor for the next batch (pass as cursor arg)
 */
export const backfillEmbeddingUserIds = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    patchedCount: v.number(),
    skippedCount: v.number(),
    scannedCount: v.number(),
    isComplete: v.boolean(),
    nextCursor: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    let patchedCount = 0;
    let skippedCount = 0;

    const page = await ctx.db
      .query("memoryEmbeddings")
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE });

    for (const embRow of page.page) {
      // Already has userId — nothing to do.
      if ((embRow as any).userId) {
        skippedCount += 1;
        continue;
      }

      // Look up the parent memory to get the owner.
      const memory = await ctx.db.get(embRow.memoryId);
      if (!memory?.userId) {
        // Orphaned embedding (memory deleted) — skip, leave for GC.
        skippedCount += 1;
        continue;
      }

      patchedCount += 1;
      if (!dryRun) {
        await ctx.db.patch(embRow._id, { userId: memory.userId } as any);
      }
    }

    return {
      patchedCount,
      skippedCount,
      scannedCount: page.page.length,
      isComplete: page.isDone,
      nextCursor: page.isDone ? undefined : page.continueCursor,
    };
  },
});
