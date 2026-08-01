import { v, ConvexError } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import {
  getNotionOAuthClientConfig,
  NOTION_OAUTH_REVOKE_URL,
  NOTION_OAUTH_TOKEN_URL,
  notionOAuthHeaders,
} from "./notion_oauth";
import {
  assertEncryptedSecret,
  decryptOAuthCredentials,
  encryptOAuthCredentials,
} from "../lib/secret_crypto";
export const exchangeNotionCode = action({
  args: {
    code: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    const clientConfig = getNotionOAuthClientConfig();

    const tokenResponse = await fetch(NOTION_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: notionOAuthHeaders(clientConfig),
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: args.code,
        redirect_uri: args.redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      throw new ConvexError({ code: "EXTERNAL_SERVICE", message: `Notion token exchange failed (HTTP ${tokenResponse.status})` });
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string | null;
      expires_in?: number;
      token_type: string;
      bot_id: string;
      workspace_id: string;
      workspace_name?: string;
      workspace_icon?: string;
      owner?: {
        type: string;
        user?: {
          id: string;
          name?: string;
          person?: { email?: string };
        };
      };
    };

    if (!tokens.access_token) {
      throw new ConvexError({ code: "EXTERNAL_SERVICE", message: "Notion did not return an access token." });
    }

    let email: string | undefined;
    let displayName: string | undefined;
    if (tokens.owner?.type === "user" && tokens.owner.user) {
      displayName = tokens.owner.user.name ?? undefined;
      email = tokens.owner.user.person?.email ?? undefined;
    }

    const expiresAt = Number.isFinite(tokens.expires_in)
      ? Date.now() + Math.max(0, tokens.expires_in ?? 0) * 1000
      : Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;

    const encrypted = await encryptOAuthCredentials({
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? "",
      provider: "notion",
    });
    await ctx.runMutation(internal.oauth.notion.upsertConnection, {
      userId,
      ...encrypted,
      expiresAt,
      scopes: [],
      email,
      displayName,
      workspaceId: tokens.workspace_id,
      workspaceName: tokens.workspace_name,
    });

    return {
      success: true,
      email: email ?? null,
      workspaceName: tokens.workspace_name ?? null,
    };
  },
});

export const upsertConnection = internalMutation({
  args: {
    userId: v.string(),
    encryptedAccessToken: v.string(),
    encryptedRefreshToken: v.string(),
    secretEnvelopeVersion: v.literal(2),
    secretKeyId: v.string(),
    expiresAt: v.number(),
    scopes: v.array(v.string()),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    workspaceName: v.optional(v.string()),
    expectedLastRefreshedAt: v.optional(v.number()),
    expectedConnectionId: v.optional(v.id("oauthConnections")),
  },
  handler: async (ctx, args) => {
    assertEncryptedSecret(args.encryptedAccessToken);
    assertEncryptedSecret(args.encryptedRefreshToken, true);
    const existing = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "notion"),
      )
      .unique();

    const now = Date.now();

    if (args.expectedConnectionId && existing?._id !== args.expectedConnectionId) return null;

    if (existing) {
      if (args.expectedLastRefreshedAt !== undefined) {
        const storedRefreshedAt = existing.lastRefreshedAt ?? 0;
        if (storedRefreshedAt !== args.expectedLastRefreshedAt) {
          return existing._id;
        }
      }

      const patch: Record<string, unknown> = {
        accessToken: args.encryptedAccessToken,
        refreshToken: args.encryptedRefreshToken || existing.refreshToken,
        expiresAt: args.expiresAt,
        scopes: args.scopes,
        status: "active",
        errorMessage: undefined,
        lastRefreshedAt: now,
        secretEnvelopeVersion: args.secretEnvelopeVersion,
        secretKeyId: args.secretKeyId,
        secretMigratedAt: now,
      };
      if (args.email) patch.email = args.email;
      if (args.displayName) patch.displayName = args.displayName;
      if (args.workspaceId) patch.workspaceId = args.workspaceId;
      if (args.workspaceName) patch.workspaceName = args.workspaceName;
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    } else {
      return await ctx.db.insert("oauthConnections", {
        userId: args.userId,
        provider: "notion",
        accessToken: args.encryptedAccessToken,
        refreshToken: args.encryptedRefreshToken,
        expiresAt: args.expiresAt,
        scopes: args.scopes,
        email: args.email,
        displayName: args.displayName,
        workspaceId: args.workspaceId,
        workspaceName: args.workspaceName,
        status: "active",
        connectedAt: now,
        lastRefreshedAt: now,
        secretEnvelopeVersion: args.secretEnvelopeVersion,
        secretKeyId: args.secretKeyId,
        secretMigratedAt: now,
      });
    }
  },
});

export const getNotionConnection = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const connection = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", userId).eq("provider", "notion"),
      )
      .unique();

    if (!connection) {
      return null;
    }

    return {
      id: connection._id,
      email: connection.email ?? null,
      displayName: connection.displayName ?? null,
      workspaceId: connection.workspaceId ?? null,
      workspaceName: connection.workspaceName ?? null,
      status: connection.status,
      scopes: connection.scopes,
      connectedAt: connection.connectedAt,
      lastUsedAt: connection.lastUsedAt ?? null,
      errorMessage: connection.errorMessage ?? null,
    };
  },
});

export const disconnectNotion = action({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const connection = await ctx.runQuery(
      internal.oauth.notion.getConnectionInternal,
      { userId },
    );

    if (!connection) {
      throw new ConvexError({ code: "NOT_FOUND", message: "No Notion connection found." });
    }

    let revocation: { headers: Record<string, string>; token: string } | undefined;
    try {
      const credentials = await decryptOAuthCredentials({
        userId,
        provider: "notion",
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
      });
      revocation = {
        headers: notionOAuthHeaders(getNotionOAuthClientConfig()),
        token: credentials.accessToken,
      };
    } catch {
      // Local deletion remains authoritative if revocation cannot be prepared.
    }

    await ctx.runMutation(internal.oauth.notion.deleteConnection, {
      userId,
    });

    if (revocation) {
      try {
        await fetch(NOTION_OAUTH_REVOKE_URL, {
          method: "POST",
          redirect: "manual",
          headers: revocation.headers,
          body: JSON.stringify({ token: revocation.token }),
        });
      } catch {
        // Remote revocation is best effort after the local credential is gone.
      }
    }

    return { success: true };
  },
});

export const getConnectionInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "notion"),
      )
      .unique();
  },
});

export const markConnectionExpired = internalMutation({
  args: {
    userId: v.string(),
    errorMessage: v.optional(v.string()),
    expectedConnectionId: v.optional(v.id("oauthConnections")),
    expectedLastRefreshedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "notion"),
      )
      .unique();

    if (
      connection
      && (!args.expectedConnectionId || connection._id === args.expectedConnectionId)
      && (args.expectedLastRefreshedAt === undefined
        || (connection.lastRefreshedAt ?? 0) === args.expectedLastRefreshedAt)
    ) {
      await ctx.db.patch(connection._id, {
        status: "expired",
        errorMessage: args.errorMessage ?? "Token refresh failed",
      });
    }
  },
});

export const deleteConnection = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "notion"),
      )
      .unique();

    if (connection) {
      await ctx.db.delete(connection._id);
    }
  },
});
