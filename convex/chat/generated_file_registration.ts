import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { assertCurrentFence } from "../execution/control_plane";
import type { GeneratedFileMetadata } from "./generated_file_helpers";
import { preferCurrentPresentationSnapshot } from "./presentation_generated_file_snapshot";

const generatedFileMetadataValidator = v.object({
  storageId: v.id("_storage"),
  originalStorageId: v.optional(v.id("_storage")),
  filename: v.string(),
  mimeType: v.string(),
  sizeBytes: v.optional(v.number()),
  toolName: v.string(),
  title: v.optional(v.string()),
  summary: v.optional(v.string()),
  presentationProjectId: v.optional(v.id("presentationProjects")),
  presentationRevision: v.optional(v.number()),
});

export async function ensureGeneratedFileRow(
  ctx: MutationCtx,
  args: {
    userId: string;
    chatId: Id<"chats">;
    messageId: Id<"messages">;
    file: GeneratedFileMetadata;
  },
): Promise<{ id: Id<"generatedFiles">; file: GeneratedFileMetadata }> {
  const file = await preferCurrentPresentationSnapshot(ctx, args.userId, args.file);
  const existing = (await ctx.db
    .query("generatedFiles")
    .withIndex("by_storage", (query) => query.eq("storageId", file.storageId))
    .collect())
    .find((candidate) =>
      candidate.userId === args.userId
      && candidate.chatId === args.chatId
      && candidate.messageId === args.messageId
    );
  if (existing) return { id: existing._id, file };

  const id = await ctx.db.insert("generatedFiles", {
    userId: args.userId,
    chatId: args.chatId,
    messageId: args.messageId,
    storageId: file.storageId,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    toolName: file.toolName,
    presentationProjectId: file.presentationProjectId,
    presentationRevision: file.presentationRevision,
    createdAt: Date.now(),
  });
  return { id, file };
}

export const registerGeneratedFilesForToolRound = internalMutation({
  args: {
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    jobId: v.id("generationJobs"),
    executionAttemptId: v.id("executionAttempts"),
    executionFence: v.number(),
    files: v.array(generatedFileMetadataValidator),
  },
  returns: v.array(v.id("generatedFiles")),
  handler: async (ctx, args) => {
    await assertCurrentFence(ctx, args.executionAttemptId, args.executionFence);
    const [job, message] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.messageId),
    ]);
    if (
      !job || !message
      || job.userId !== args.userId || message.userId !== args.userId
      || job.chatId !== args.chatId || message.chatId !== args.chatId
      || job.messageId !== args.messageId
      || !["queued", "streaming"].includes(job.status)
    ) {
      throw new Error("GENERATED_FILE_CONTEXT_STALE");
    }

    const ids: Id<"generatedFiles">[] = [];
    for (const file of args.files) {
      const registered = await ensureGeneratedFileRow(ctx, {
        userId: args.userId,
        chatId: args.chatId,
        messageId: args.messageId,
        file,
      });
      ids.push(registered.id);
    }
    const generatedFileIds = Array.from(new Set([
      ...(message.generatedFileIds ?? []),
      ...ids,
    ]));
    await ctx.db.patch(message._id, { generatedFileIds });
    return ids;
  },
});
