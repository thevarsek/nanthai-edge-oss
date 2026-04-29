"use node";

import { v, ConvexError } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import { encryptSecret } from "../lib/secret_crypto";
import { validateGmailManualCredentials } from "../tools/google/gmail_manual_client";

export const connectGmailManual = action({
  args: {
    email: v.string(),
    appPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const email = args.email.trim().toLowerCase();
    const appPassword = args.appPassword.replace(/\s+/g, "");

    if (!email || !appPassword) {
      throw new ConvexError({ code: "VALIDATION", message: "Gmail address and app password are required." });
    }

    try {
      await validateGmailManualCredentials({ email, appPassword });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ConvexError({
        code: "UNAUTHORIZED" as const,
        message: message || "Gmail sign-in failed. Confirm IMAP is enabled and the password is a Google app password.",
      });
    }

    await ctx.runMutation(internal.oauth.gmail_manual.upsertConnection, {
      userId,
      email,
      appPassword: await encryptSecret(appPassword),
    });

    return { success: true, email };
  },
});

export const disconnectGmailManual = action({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    await ctx.runMutation(internal.oauth.gmail_manual.deleteConnection, { userId });
    return { success: true };
  },
});
