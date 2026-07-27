import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import type { SubmitContentReportArgs } from "./validators";

const MAX_DETAILS_LENGTH = 1_000;
const MAX_SNAPSHOT_LENGTH = 4_000;
const MAX_VERSION_LENGTH = 64;
const MAX_MEDIA_URLS = 4;
const MAX_ATTACHMENTS = 8;

function optionalBoundedText(
  value: string | undefined,
  maxLength: number,
  field: string,
): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new ConvexError({
      code: "VALIDATION",
      message: `${field} must be ${maxLength} characters or fewer.`,
    });
  }
  return normalized;
}

export async function submitContentReportHandler(
  ctx: MutationCtx,
  args: SubmitContentReportArgs,
): Promise<{ reportId: Id<"aiContentReports">; alreadyReported: boolean }> {
  const { userId } = await requireAuth(ctx);
  const message = await ctx.db.get(args.messageId);
  const chat = message ? await ctx.db.get(message.chatId) : null;
  if (
    !message
    || !chat
    || chat.userId !== userId
    || (message.userId !== undefined && message.userId !== userId)
    || message.role !== "assistant"
  ) {
    throw new ConvexError({ code: "NOT_FOUND", message: "AI response not found." });
  }

  const existing = await ctx.db
    .query("aiContentReports")
    .withIndex("by_user_message", (query) =>
      query.eq("userId", userId).eq("messageId", message._id)
    )
    .unique();
  if (existing) {
    return { reportId: existing._id, alreadyReported: true };
  }

  const details = optionalBoundedText(args.details, MAX_DETAILS_LENGTH, "Details");
  const appVersion = optionalBoundedText(args.appVersion, MAX_VERSION_LENGTH, "App version");
  const buildNumber = optionalBoundedText(args.buildNumber, MAX_VERSION_LENGTH, "Build number");
  const contentSnapshot = message.content.trim().slice(0, MAX_SNAPSHOT_LENGTH) || undefined;
  const imageUrls = (message.imageUrls ?? []).slice(0, MAX_MEDIA_URLS);
  const videoUrls = (message.videoUrls ?? []).slice(0, MAX_MEDIA_URLS);
  const attachmentSummaries = (message.attachments ?? [])
    .slice(0, MAX_ATTACHMENTS)
    .map((attachment) => ({
      type: attachment.type,
      name: attachment.name,
      mimeType: attachment.mimeType,
    }));
  const hasAudio = message.audioStorageId !== undefined;
  const contentKinds = [
    ...(contentSnapshot ? ["text" as const] : []),
    ...(imageUrls.length > 0 ? ["image" as const] : []),
    ...(videoUrls.length > 0 ? ["video" as const] : []),
    ...(hasAudio ? ["audio" as const] : []),
    ...(attachmentSummaries.length > 0 ? ["file" as const] : []),
  ];
  if (contentKinds.length === 0) {
    throw new ConvexError({
      code: "VALIDATION",
      message: "This AI response has no reportable content.",
    });
  }

  const now = Date.now();
  const reportId = await ctx.db.insert("aiContentReports", {
    userId,
    chatId: message.chatId,
    messageId: message._id,
    reason: args.reason,
    details,
    contentKinds,
    contentSnapshot,
    imageUrls,
    videoUrls,
    attachmentSummaries,
    hasAudio,
    modelId: message.modelId,
    participantName: message.participantName,
    sourceMessageStatus: message.status,
    platform: args.platform,
    appVersion,
    buildNumber,
    status: "open",
    createdAt: now,
    updatedAt: now,
  });
  return { reportId, alreadyReported: false };
}
