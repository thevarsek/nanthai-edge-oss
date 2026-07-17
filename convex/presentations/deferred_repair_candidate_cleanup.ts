"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";

export const deletePresentationRepairCandidate = internalAction({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<void> => {
    try {
      await ctx.storage.delete(args.storageId);
    } catch {
      // The successful repair path normally deletes the private candidate first.
    }
  },
});
