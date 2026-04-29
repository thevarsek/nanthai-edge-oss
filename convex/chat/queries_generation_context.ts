// convex/chat/queries_generation_context.ts
// =============================================================================
// Consolidated preflight query for runGenerationHandler.
// Replaces ~13 individual round-trips with a single internalQuery.
// =============================================================================

import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { deriveGoogleCapabilityFlags } from "../oauth/google_capabilities";
import { isUserPro } from "../preferences/entitlements";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerationContext {
  isPro: boolean;
  currentUserMessage: Record<string, unknown> | null;
  chatDoc: Record<string, unknown> | null;
  skillIntegrationDefaults: {
    skillDefaults: unknown;
    integrationDefaults: unknown;
  } | null;
  connectedIntegrationIds: string[];
  personasById: Record<string, Record<string, unknown> | null>;
}

// ---------------------------------------------------------------------------
// Provider list — must stay in sync with tools/index.ts helpers.
// ---------------------------------------------------------------------------

const OAUTH_PROVIDERS = [
  "google",
  "gmail_manual",
  "microsoft",
  "apple_calendar",
  "notion",
  "cloze",
  "slack",
] as const;

// ---------------------------------------------------------------------------
// Handler (exported for unit testing)
// ---------------------------------------------------------------------------

export async function getGenerationContextHandler(
  ctx: QueryCtx,
  args: {
    userId: string;
    chatId: Id<"chats">;
    messageId: Id<"messages">;
    personaIds: string[];
  },
): Promise<GenerationContext> {
  // ── Batch 1: core docs (parallel) ──────────────────────────────────────
  const [isPro, messageDoc, chatDoc, prefsDoc] = await Promise.all([
    isUserPro(ctx, args.userId),
    ctx.db.get(args.messageId),
    ctx.db.get(args.chatId),
    ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first(),
  ]);

  // ── Batch 2: OAuth connections (parallel) ──────────────────────────────
  const connectionPromises = OAUTH_PROVIDERS.map((provider) =>
    ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", provider),
      )
      .first(),
  );

  // ── Batch 3: Persona docs (parallel, deduplicated by caller) ───────────
  const personaPromises = args.personaIds.map(async (personaId) => {
    try {
      const doc = await ctx.db.get(personaId as unknown as Id<"personas">);
      if (doc && doc.userId === args.userId) {
        // Resolve avatar URL if storage ID exists
        if (doc.avatarImageStorageId) {
          const avatarImageUrl = await ctx.storage.getUrl(doc.avatarImageStorageId);
          return [personaId, { ...doc, avatarImageUrl: avatarImageUrl ?? undefined }] as const;
        }
        return [personaId, { ...doc, avatarImageUrl: undefined }] as const;
      }
    } catch {
      // invalid ID format — fall through to scan
    }
    // Fallback scan (matches getPersonaHandler behavior)
    const personas = await ctx.db
      .query("personas")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const found = personas.find((p) => (p._id as string) === personaId) ?? null;
    if (found?.avatarImageStorageId) {
      const avatarImageUrl = await ctx.storage.getUrl(found.avatarImageStorageId);
      return [personaId, { ...found, avatarImageUrl: avatarImageUrl ?? undefined }] as const;
    }
    return [personaId, found ? { ...found, avatarImageUrl: undefined } : null] as const;
  });

  // Await batches 2 & 3 together
  const [connections, personaPairs] = await Promise.all([
    Promise.all(connectionPromises),
    Promise.all(personaPromises),
  ]);

  // ── Derive connectedIntegrationIds ─────────────────────────────────────
  const connectedIntegrationIds: string[] = [];
  for (let i = 0; i < OAUTH_PROVIDERS.length; i++) {
    const provider = OAUTH_PROVIDERS[i];
    const conn = connections[i];
    if (!conn || conn.status !== "active") continue;

    switch (provider) {
      case "google": {
        const flags = deriveGoogleCapabilityFlags(conn.scopes);
        if (flags.hasDrive) connectedIntegrationIds.push("drive");
        if (flags.hasCalendar) connectedIntegrationIds.push("calendar");
        break;
      }
      case "gmail_manual":
        connectedIntegrationIds.push("gmail");
        break;
      case "microsoft":
        connectedIntegrationIds.push("outlook", "onedrive", "ms_calendar");
        break;
      case "apple_calendar":
        connectedIntegrationIds.push("apple_calendar");
        break;
      case "notion":
        connectedIntegrationIds.push("notion");
        break;
      case "cloze":
        connectedIntegrationIds.push("cloze");
        break;
      case "slack":
        connectedIntegrationIds.push("slack");
        break;
    }
  }

  // ── Build personas map ─────────────────────────────────────────────────
  const personasById: Record<string, Record<string, unknown> | null> = {};
  for (const [id, doc] of personaPairs) {
    personasById[id] = doc as Record<string, unknown> | null;
  }

  return {
    isPro,
    currentUserMessage: messageDoc as GenerationContext["currentUserMessage"],
    chatDoc: chatDoc as Record<string, unknown> | null,
    skillIntegrationDefaults: {
      skillDefaults: prefsDoc?.skillDefaults ?? undefined,
      integrationDefaults: prefsDoc?.integrationDefaults ?? undefined,
    },
    connectedIntegrationIds,
    personasById,
  };
}

// ---------------------------------------------------------------------------
// Convex registration
// ---------------------------------------------------------------------------

export const getGenerationContext = internalQuery({
  args: {
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    personaIds: v.array(v.string()),
  },
  handler: getGenerationContextHandler,
});
