import { v, type PropertyValidators } from "convex/values";

export const contentReportReason = v.union(
  v.literal("hate_or_harassment"),
  v.literal("sexual_content"),
  v.literal("violence_or_self_harm"),
  v.literal("child_safety"),
  v.literal("dangerous_or_illegal"),
  v.literal("deceptive_or_misleading"),
  v.literal("other"),
);

export const contentReportPlatform = v.union(
  v.literal("web"),
  v.literal("ios"),
  v.literal("android"),
);

export const contentReportKind = v.union(
  v.literal("text"),
  v.literal("image"),
  v.literal("video"),
  v.literal("audio"),
  v.literal("file"),
);

export const contentReportStatus = v.union(
  v.literal("open"),
  v.literal("reviewed"),
  v.literal("actioned"),
  v.literal("dismissed"),
);

export const submitContentReportArgs = {
  messageId: v.id("messages"),
  reason: contentReportReason,
  details: v.optional(v.string()),
  platform: contentReportPlatform,
  appVersion: v.optional(v.string()),
  buildNumber: v.optional(v.string()),
} satisfies PropertyValidators;

export const submitContentReportResult = v.object({
  reportId: v.id("aiContentReports"),
  alreadyReported: v.boolean(),
});

export type ContentReportReason =
  | "hate_or_harassment"
  | "sexual_content"
  | "violence_or_self_harm"
  | "child_safety"
  | "dangerous_or_illegal"
  | "deceptive_or_misleading"
  | "other";

export type ContentReportPlatform = "web" | "ios" | "android";

export interface SubmitContentReportArgs {
  messageId: import("../_generated/dataModel").Id<"messages">;
  reason: ContentReportReason;
  details?: string;
  platform: ContentReportPlatform;
  appVersion?: string;
  buildNumber?: string;
}
