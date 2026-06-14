"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { readPdfBlob } from "../runtime/service_pdf";
import type { ToolExecutionContext } from "../tools/registry";
import { serializableToolContextValidator } from "../tools/proxy_context";

export const extractPdfVersion = internalAction({
  args: {
    storageId: v.id("_storage"),
    filename: v.string(),
    toolContext: serializableToolContextValidator,
  },
  handler: async (ctx, args) => {
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) {
      throw new Error("Document bytes not found.");
    }
    const toolCtx: ToolExecutionContext = {
      ctx,
      ...args.toolContext,
    };
    const extracted = await readPdfBlob(
      toolCtx,
      blob,
      args.filename,
    );
    return {
      text: extracted.text,
      markdown: extracted.text,
      pageCount: extracted.pageCount,
      wordCount: extracted.text.split(/\s+/).filter(Boolean).length,
    };
  },
});
