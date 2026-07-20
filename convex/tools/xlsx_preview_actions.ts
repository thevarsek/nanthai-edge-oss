"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { createXlsxPreview } from "../runtime/service_xlsx_preview";

export const createPreview = internalAction({
  args: {
    userId: v.string(),
    chatId: v.string(),
    storageId: v.id("_storage"),
    title: v.string(),
  },
  handler: async (ctx, args) =>
    await createXlsxPreview(
      { ctx, userId: args.userId, chatId: args.chatId },
      { storageId: args.storageId, title: args.title },
    ),
});
