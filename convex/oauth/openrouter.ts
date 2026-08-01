import { ConvexError, v } from "convex/values";
import { action, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import {
  assertEncryptedSecret,
  encryptSecret,
  parseSecretEnvelope,
  userApiKeySecretContext,
} from "../lib/secret_crypto";

const OPENROUTER_KEY_EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";

function externalServiceError(status?: number): ConvexError<{
  code: "EXTERNAL_SERVICE";
  message: string;
}> {
  return new ConvexError({
    code: "EXTERNAL_SERVICE" as const,
    message: status
      ? `OpenRouter connection failed (HTTP ${status}). Please try again.`
      : "OpenRouter connection failed. Please try again.",
  });
}

export const exchangeAndStore = action({
  args: {
    code: v.string(),
    codeVerifier: v.string(),
  },
  returns: v.object({ connected: v.literal(true) }),
  handler: async (ctx, args): Promise<{ connected: true }> => {
    const { userId } = await requireAuth(ctx);
    const attemptId = crypto.randomUUID();
    const started = await ctx.runMutation(internal.oauth.openrouter.beginExchange, {
      userId,
      attemptId,
    });
    if (!started) {
      throw new ConvexError({
        code: "ACCOUNT_DELETION_IN_PROGRESS" as const,
        message: "Account deletion is in progress.",
      });
    }
    const code = args.code.trim();
    const codeVerifier = args.codeVerifier.trim();
    if (!code || code.length > 4096 || codeVerifier.length < 43 || codeVerifier.length > 128) {
      throw new ConvexError({
        code: "VALIDATION" as const,
        message: "The OpenRouter authorization response is invalid. Start the connection again.",
      });
    }

    let response: Response;
    try {
      response = await fetch(OPENROUTER_KEY_EXCHANGE_URL, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          code_verifier: codeVerifier,
          code_challenge_method: "S256",
        }),
      });
    } catch {
      throw externalServiceError();
    }
    if (!response.ok) throw externalServiceError(response.status);

    let apiKey: string | undefined;
    try {
      const payload = await response.json() as { key?: unknown };
      apiKey = typeof payload.key === "string" ? payload.key.trim() : undefined;
    } catch {
      throw externalServiceError(response.status);
    }
    if (!apiKey) throw externalServiceError(response.status);

    const encryptedApiKey = await encryptSecret(
      apiKey,
      userApiKeySecretContext(userId),
    );
    const stored = await ctx.runMutation(internal.oauth.openrouter.upsertEncryptedApiKey, {
      userId,
      attemptId,
      encryptedApiKey,
    });
    if (!stored) {
      throw new ConvexError({
        code: "OAUTH_EXCHANGE_SUPERSEDED" as const,
        message: "This OpenRouter connection attempt is no longer active. Start it again.",
      });
    }
    return { connected: true };
  },
});

export const beginExchange = internalMutation({
  args: { userId: v.string(), attemptId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const deleting = await ctx.db
      .query("accountDeletionTombstones")
      .withIndex("by_user", (query) => query.eq("userId", args.userId))
      .unique();
    if (deleting) return false;
    const existing = await ctx.db
      .query("openRouterExchangeAttempts")
      .withIndex("by_user", (query) => query.eq("userId", args.userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { attemptId: args.attemptId, createdAt: Date.now() });
    } else {
      await ctx.db.insert("openRouterExchangeAttempts", { ...args, createdAt: Date.now() });
    }
    return true;
  },
});

export const upsertEncryptedApiKey = internalMutation({
  args: {
    userId: v.string(),
    attemptId: v.string(),
    encryptedApiKey: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const [attempt, deleting] = await Promise.all([
      ctx.db
        .query("openRouterExchangeAttempts")
        .withIndex("by_user", (query) => query.eq("userId", args.userId))
        .unique(),
      ctx.db
        .query("accountDeletionTombstones")
        .withIndex("by_user", (query) => query.eq("userId", args.userId))
        .unique(),
    ]);
    if (!attempt || attempt.attemptId !== args.attemptId || deleting) return false;
    assertEncryptedSecret(args.encryptedApiKey);
    const metadata = parseSecretEnvelope(args.encryptedApiKey);
    if (!metadata) throw new Error("Encrypted API key metadata is missing.");
    const now = Date.now();
    const existing = await ctx.db
      .query("userSecrets")
      .withIndex("by_user", (query) => query.eq("userId", args.userId))
      .unique();
    const values = {
      apiKey: args.encryptedApiKey,
      secretEnvelopeVersion: metadata.envelopeVersion,
      secretKeyId: metadata.keyId,
      secretMigratedAt: now,
      updatedAt: now,
    } as const;
    if (existing) {
      await ctx.db.patch(existing._id, values);
    } else {
      await ctx.db.insert("userSecrets", { userId: args.userId, ...values });
    }
    await ctx.db.delete(attempt._id);
    return true;
  },
});
