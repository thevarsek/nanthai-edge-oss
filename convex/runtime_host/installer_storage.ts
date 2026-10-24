import { ConvexError, v } from "convex/values";
import { internalMutation } from "../_generated/server";

const INSTALLER_CONTENT_TYPE = "application/x-apple-diskimage";

/**
 * Operator-only publication of the public Mac installer. Internal functions are
 * reachable only with deployment credentials (`npx convex run --prod`), never
 * from clients. The resulting storage URL becomes NANTHAI_RUNTIME_HOST_DOWNLOAD_URL.
 */
export const generateInstallerUploadUrl = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/** Retires a superseded installer; refuses any stored file that is not a DMG. */
export const deleteInstaller = internalMutation({
  args: { storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { storageId }) => {
    const file = await ctx.db.system.get(storageId);
    if (!file) throw new ConvexError({ code: "NOT_FOUND" });
    if (file.contentType !== INSTALLER_CONTENT_TYPE) throw new ConvexError({ code: "NOT_AN_INSTALLER" });
    await ctx.storage.delete(storageId);
    return null;
  },
});
