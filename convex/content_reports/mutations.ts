import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { submitContentReportHandler } from "./handlers";
import {
  contentReportPlatform,
  contentReportReason,
  submitContentReportResult,
} from "./validators";

export const submit = mutation({
  args: {
    messageId: v.id("messages"),
    reason: contentReportReason,
    details: v.optional(v.string()),
    platform: contentReportPlatform,
    appVersion: v.optional(v.string()),
    buildNumber: v.optional(v.string()),
  },
  returns: submitContentReportResult,
  handler: async (ctx, args) => submitContentReportHandler(ctx, args),
});
