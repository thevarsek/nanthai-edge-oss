// convex/preferences/mutations.ts
// =============================================================================
// User Preferences & Model Settings mutations.
//
// UserPreferences is a singleton per user (get-or-create pattern).
// ModelSettings are per-model overrides keyed by OpenRouter model ID.
// =============================================================================

import { ConvexError, v } from "convex/values";
import { mutation, internalMutation, MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth, requirePro } from "../lib/auth";


// Batch size for paginating chat subagent-override resets. Kept small enough
// to stay well inside Convex's 16,384-document read limit per transaction.
const DISABLE_PRO_CHAT_BATCH_SIZE = 200;

function buildDefaultUserPreferencesInsert(
  userId: string,
  now: number,
): Record<string, unknown> {
  return {
    userId,
    sendOnEnter: true,
    showReasoning: true,
    hapticFeedback: true,
    appearanceMode: "light",
    pickerFilterFree: false,
    pickerFilterExcludeFree: false,
    pickerFilterVision: false,
    pickerFilterImageGen: false,
    pickerFilterTools: false,
    webSearchEnabledByDefault: true,
    subagentsEnabledByDefault: false,
    chatCompletionNotificationsEnabled: false,
    autoAudioResponse: false,
    preferredVoice: "nova",
    defaultAudioSpeed: 1,
    isMemoryEnabled: true,
    memoryGatingMode: "automatic",
    updatedAt: now,
  };
}

// -- User Preferences ---------------------------------------------------------

/**
 * Ensure a userPreferences row exists for the authenticated user.
 * Creates with defaults if missing; returns the existing row otherwise.
 *
 * Idempotent — safe to call on every app launch / page load.
 * Called by AuthGuard (web), app launch (iOS/Android), and Stripe webhook.
 */
export const ensureUserPreferences = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const now = Date.now();

    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (existing) return existing._id;

    return await ctx.db.insert(
      "userPreferences",
      buildDefaultUserPreferencesInsert(userId, now) as any,
    );
  },
});

/**
 * Internal version for use from Stripe webhook and other internal functions.
 */
export const ensureUserPreferencesInternal = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();

    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) return existing._id;

    return await ctx.db.insert(
      "userPreferences",
      buildDefaultUserPreferencesInsert(args.userId, now) as any,
    );
  },
});

/** Upsert user preferences. Creates if missing, patches if existing. */
export const upsertPreferences = mutation({
  args: {
    defaultModelId: v.optional(v.string()),
    defaultPersonaId: v.optional(v.union(v.id("personas"), v.null())),
    clearDefaultPersona: v.optional(v.boolean()),
    sendOnEnter: v.optional(v.boolean()),
    showReasoning: v.optional(v.boolean()),
    hapticFeedback: v.optional(v.boolean()),
    appearanceMode: v.optional(v.string()),
    colorTheme: v.optional(v.union(
      v.literal("vibrant"),
      v.literal("highContrast"),
      v.literal("teal"),
      v.literal("lilac"),
      v.null(),
    )),
    defaultTemperature: v.optional(v.union(v.number(), v.null())),
    defaultMaxTokens: v.optional(v.union(v.number(), v.null())),
    includeReasoning: v.optional(v.union(v.boolean(), v.null())),
    reasoningEffort: v.optional(v.union(v.string(), v.null())),
    pickerFilterFree: v.optional(v.boolean()),
    pickerFilterExcludeFree: v.optional(v.boolean()),
    pickerFilterVision: v.optional(v.boolean()),
    pickerFilterImageGen: v.optional(v.boolean()),
    pickerFilterTools: v.optional(v.boolean()),
    pickerSortPrimaryKey: v.optional(v.union(
      v.literal("recommended"),
      v.literal("coding"),
      v.literal("research"),
      v.literal("fast"),
      v.literal("value"),
      v.literal("image"),
      v.literal("price"),
      v.literal("context"),
      v.null(),
    )),
    pickerSortPrimaryDirection: v.optional(v.union(
      v.literal("asc"),
      v.literal("desc"),
      v.null(),
    )),
    pickerSortSecondaryKey: v.optional(v.union(
      v.literal("recommended"),
      v.literal("coding"),
      v.literal("research"),
      v.literal("fast"),
      v.literal("value"),
      v.literal("image"),
      v.literal("price"),
      v.literal("context"),
      v.null(),
    )),
    pickerSortSecondaryDirection: v.optional(v.union(
      v.literal("asc"),
      v.literal("desc"),
      v.null(),
    )),
    webSearchEnabledByDefault: v.optional(v.boolean()),
    subagentsEnabledByDefault: v.optional(v.boolean()),
    chatCompletionNotificationsEnabled: v.optional(v.boolean()),
    defaultSearchMode: v.optional(v.union(v.string(), v.null())),
    defaultSearchComplexity: v.optional(v.union(v.number(), v.null())),
    autoAudioResponse: v.optional(v.boolean()),
    preferredVoice: v.optional(v.union(v.string(), v.null())),
    defaultAudioSpeed: v.optional(v.union(v.number(), v.null())),
    isMemoryEnabled: v.optional(v.boolean()),
    memoryGatingMode: v.optional(v.string()),
    memoryExtractionModelId: v.optional(v.union(v.string(), v.null())),
    titleModelId: v.optional(v.union(v.string(), v.null())),
    disabledProviders: v.optional(v.union(v.array(v.string()), v.null())),
    hasSeenIdeascapeHelp: v.optional(v.boolean()),
    hasSeenMainWalkthrough: v.optional(v.boolean()),
    showBalanceInChat: v.optional(v.boolean()),
    showAdvancedStats: v.optional(v.boolean()),
    defaultVideoAspectRatio: v.optional(v.union(v.string(), v.null())),
    defaultVideoDuration: v.optional(v.union(v.number(), v.null())),
    defaultVideoResolution: v.optional(v.union(v.string(), v.null())),
    defaultVideoGenerateAudio: v.optional(v.boolean()),
    zdrEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const now = Date.now();

    if (args.subagentsEnabledByDefault === true) {
      await requirePro(ctx, userId);
    }

    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    // Build patch object — only include args that were explicitly provided.
    // For optional schema fields, `null` from the client means "clear field".
    // Convex optional fields are cleared by patching with `undefined`.
    const patch: Record<string, unknown> = { updatedAt: now };
    for (const [key, value] of Object.entries(args)) {
      if (key === "clearDefaultPersona") continue;
      if (value === undefined) continue;
      patch[key] = value === null ? undefined : value;
    }
    // Explicit clear flag avoids relying on client-side null transport details.
    if (args.clearDefaultPersona === true) {
      patch.defaultPersonaId = undefined;
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    // Create with defaults
    return await ctx.db.insert("userPreferences", {
      ...buildDefaultUserPreferencesInsert(userId, now) as any,
      defaultModelId: args.defaultModelId,
      defaultPersonaId:
        args.clearDefaultPersona === true
          ? undefined
          : (args.defaultPersonaId ?? undefined),
      sendOnEnter: args.sendOnEnter ?? true,
      showReasoning: args.showReasoning ?? true,
      hapticFeedback: args.hapticFeedback ?? true,
      appearanceMode: args.appearanceMode ?? "light",
      colorTheme: args.colorTheme ?? undefined,
      defaultTemperature: args.defaultTemperature ?? undefined,
      defaultMaxTokens: args.defaultMaxTokens ?? undefined,
      includeReasoning: args.includeReasoning ?? undefined,
      reasoningEffort: args.reasoningEffort ?? undefined,
      pickerFilterFree: args.pickerFilterFree ?? false,
      pickerFilterExcludeFree: args.pickerFilterExcludeFree ?? false,
      pickerFilterVision: args.pickerFilterVision ?? false,
      pickerFilterImageGen: args.pickerFilterImageGen ?? false,
      pickerFilterTools: args.pickerFilterTools ?? false,
      pickerSortPrimaryKey: args.pickerSortPrimaryKey ?? undefined,
      pickerSortPrimaryDirection: args.pickerSortPrimaryDirection ?? undefined,
      pickerSortSecondaryKey: args.pickerSortSecondaryKey ?? undefined,
      pickerSortSecondaryDirection: args.pickerSortSecondaryDirection ?? undefined,
      webSearchEnabledByDefault: args.webSearchEnabledByDefault ?? true,
      subagentsEnabledByDefault: args.subagentsEnabledByDefault ?? false,
      chatCompletionNotificationsEnabled: args.chatCompletionNotificationsEnabled ?? false,
      defaultSearchMode: args.defaultSearchMode ?? undefined,
      defaultSearchComplexity: args.defaultSearchComplexity ?? undefined,
      autoAudioResponse: args.autoAudioResponse ?? false,
      preferredVoice: args.preferredVoice ?? "nova",
      defaultAudioSpeed: args.defaultAudioSpeed ?? 1,
      isMemoryEnabled: args.isMemoryEnabled ?? true,
      memoryGatingMode: args.memoryGatingMode ?? "automatic",
      memoryExtractionModelId: args.memoryExtractionModelId ?? undefined,
      titleModelId: args.titleModelId ?? undefined,
      disabledProviders: args.disabledProviders ?? undefined,
      hasSeenIdeascapeHelp: args.hasSeenIdeascapeHelp ?? undefined,
      hasSeenMainWalkthrough: args.hasSeenMainWalkthrough ?? undefined,
      showBalanceInChat: args.showBalanceInChat ?? undefined,
      showAdvancedStats: args.showAdvancedStats ?? undefined,
      defaultVideoAspectRatio: args.defaultVideoAspectRatio ?? undefined,
      defaultVideoDuration: args.defaultVideoDuration ?? undefined,
      defaultVideoResolution: args.defaultVideoResolution ?? undefined,
      defaultVideoGenerateAudio: args.defaultVideoGenerateAudio ?? undefined,
      updatedAt: now,
    });
  },
});

// -- Model Settings -----------------------------------------------------------

// -- M30: Global Skill & Integration Defaults ---------------------------------

/**
 * Set or update a single global skill default.
 *
 * The `skillDefaults` array on `userPreferences` is sparse: absence of an entry
 * means the system default applies (built-in system skills = "available",
 * custom/user skills = "never"). Calling this upserts one entry.
 */
export const setSkillDefault = mutation({
  args: {
    skillId: v.id("skills"),
    state: v.union(v.literal("always"), v.literal("available"), v.literal("never")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const now = Date.now();

    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!prefs) {
      return await ctx.db.insert("userPreferences", {
        ...buildDefaultUserPreferencesInsert(userId, now) as any,
        skillDefaults: [{ skillId: args.skillId, state: args.state }],
      });
    }

    const existing = prefs.skillDefaults ?? [];
    const updated = existing.filter((e: any) => e.skillId !== args.skillId);
    updated.push({ skillId: args.skillId, state: args.state });
    await ctx.db.patch(prefs._id, { skillDefaults: updated, updatedAt: now });
    return prefs._id;
  },
});

/**
 * Remove a global skill default (revert to system default).
 */
export const removeSkillDefault = mutation({
  args: { skillId: v.id("skills") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const now = Date.now();

    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!prefs || !prefs.skillDefaults) return;

    const updated = (prefs.skillDefaults as any[]).filter((e: any) => e.skillId !== args.skillId);
    await ctx.db.patch(prefs._id, {
      skillDefaults: updated.length > 0 ? updated : undefined,
      updatedAt: now,
    });
  },
});

/**
 * Set or update a single global integration default.
 *
 * The `integrationDefaults` array on `userPreferences` is sparse: absence of an
 * entry means the integration is disabled by default (new connections after M30
 * default to disabled). Calling this upserts one entry.
 */
export const setIntegrationDefault = mutation({
  args: {
    integrationId: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const now = Date.now();

    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!prefs) {
      return await ctx.db.insert("userPreferences", {
        ...buildDefaultUserPreferencesInsert(userId, now) as any,
        integrationDefaults: [{ integrationId: args.integrationId, enabled: args.enabled }],
      });
    }

    const existing = prefs.integrationDefaults ?? [];
    const updated = existing.filter((e: any) => e.integrationId !== args.integrationId);
    updated.push({ integrationId: args.integrationId, enabled: args.enabled });
    await ctx.db.patch(prefs._id, { integrationDefaults: updated, updatedAt: now });
    return prefs._id;
  },
});

/**
 * Remove a global integration default (revert to system default = disabled).
 */
export const removeIntegrationDefault = mutation({
  args: { integrationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const now = Date.now();

    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!prefs || !prefs.integrationDefaults) return;

    const updated = (prefs.integrationDefaults as any[]).filter(
      (e: any) => e.integrationId !== args.integrationId,
    );
    await ctx.db.patch(prefs._id, {
      integrationDefaults: updated.length > 0 ? updated : undefined,
      updatedAt: now,
    });
  },
});

// -- Model Settings (continued) -----------------------------------------------

/** Upsert per-model parameter overrides. */
export const upsertModelSettings = mutation({
  args: {
    openRouterId: v.string(),
    temperature: v.optional(v.union(v.number(), v.null())),
    maxTokens: v.optional(v.union(v.number(), v.null())),
    includeReasoning: v.optional(v.union(v.boolean(), v.null())),
    reasoningEffort: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const now = Date.now();

    const existing = await ctx.db
      .query("modelSettings")
      .withIndex("by_user_model", (q) =>
        q.eq("userId", userId).eq("openRouterId", args.openRouterId),
      )
      .first();

    const patch: Record<string, unknown> = { updatedAt: now };
    for (const [key, value] of Object.entries(args)) {
      if (key !== "openRouterId" && value !== undefined) {
        patch[key] = value === null ? undefined : value;
      }
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("modelSettings", {
      userId,
      openRouterId: args.openRouterId,
      temperature: args.temperature ?? undefined,
      maxTokens: args.maxTokens ?? undefined,
      includeReasoning: args.includeReasoning ?? undefined,
      reasoningEffort: args.reasoningEffort ?? undefined,
      updatedAt: now,
    });
  },
});

/** Delete per-model settings (reset to defaults). */
export const deleteModelSettings = mutation({
  args: { openRouterId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    const existing = await ctx.db
      .query("modelSettings")
      .withIndex("by_user_model", (q) =>
        q.eq("userId", userId).eq("openRouterId", args.openRouterId),
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

// -- Pro Entitlement ----------------------------------------------------------

async function upsertPurchaseEntitlement(
  ctx: MutationCtx,
  args: {
    userId: string;
    externalPurchaseId: string;
    productId: string;
    platform: "ios" | "android";
    source: "app_store" | "play_store";
    rawEnvironment?: string;
    metadata?: Record<string, unknown>;
    now: number;
    status: "active" | "revoked" | "refunded" | "expired";
  },
): Promise<void> {
  const matches = await ctx.db
    .query("purchaseEntitlements")
    .withIndex("by_external_purchase", (q) =>
      q.eq("externalPurchaseId", args.externalPurchaseId),
    )
    .collect();

  const canonical = matches[0] ?? null;
  const duplicates = matches.slice(1);

  if (canonical && canonical.userId !== args.userId) {
    throw new ConvexError({
      code: "ENTITLEMENT_USER_MISMATCH" as const,
      message: "This purchase is already linked to a different account.",
    });
  }

  for (const duplicate of duplicates) {
    if (duplicate.userId !== args.userId) {
      throw new ConvexError({
        code: "ENTITLEMENT_USER_MISMATCH" as const,
        message: "This purchase is already linked to a different account.",
      });
    }
  }

  if (canonical) {
    await ctx.db.patch(canonical._id, {
      platform: args.platform,
      source: args.source,
      productId: args.productId,
      externalPurchaseId: args.externalPurchaseId,
      status: args.status,
      activatedAt: canonical.activatedAt,
      revokedAt: args.status === "active" ? undefined : args.now,
      lastVerifiedAt: args.now,
      rawEnvironment: args.rawEnvironment,
      metadata: args.metadata,
      updatedAt: args.now,
    });

    for (const duplicate of duplicates) {
      await ctx.db.delete(duplicate._id);
    }
    return;
  }

  await ctx.db.insert("purchaseEntitlements", {
    userId: args.userId,
    platform: args.platform,
    source: args.source,
    productId: args.productId,
    externalPurchaseId: args.externalPurchaseId,
    status: args.status,
    activatedAt: args.now,
    revokedAt: args.status === "active" ? undefined : args.now,
    lastVerifiedAt: args.now,
    rawEnvironment: args.rawEnvironment,
    metadata: args.metadata,
    updatedAt: args.now,
  });
}

async function disableProClientState(ctx: MutationCtx, userId: string, now: number): Promise<void> {
  // 1. Reset Pro-gated preference fields.
  const prefs = await ctx.db
    .query("userPreferences")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();

  if (prefs) {
    await ctx.db.patch(prefs._id, {
      isMemoryEnabled: false,
      memoryGatingMode: "disabled",
      memoryExtractionModelId: undefined,
      subagentsEnabledByDefault: false,
      updatedAt: now,
    });
  }

  // 2. Reset subagentOverride on all user chats, paginated to avoid the
  //    16,384-document read limit. First batch runs immediately; subsequent
  //    batches are scheduled so each runs in its own transaction.
  await ctx.scheduler.runAfter(
    0,
    internal.preferences.mutations.disableProChatsBatch,
    { userId, now },
  );

  // 3. Purge memories in a separate action.
  await ctx.scheduler.runAfter(0, internal.memory.operations.purgeUserMemories, {
    userId,
  });
}

/**
 * Internal wrapper for non-authenticated callers (for example Stripe webhooks)
 * to apply the same Pro revocation cleanup path used by mobile clients.
 */
export const disableProClientStateInternal = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    await disableProClientState(ctx, args.userId, Date.now());
  },
});

/**
 * Internal paginated mutation: clears `subagentOverride` on all chats for a
 * user that still have it set to "enabled". Uses the sparse
 * `by_user_subagent_override` index so only chats that actually have the
 * override set are read — no full-table scan of user chats.
 *
 * Processes DISABLE_PRO_CHAT_BATCH_SIZE chats per transaction and schedules
 * itself again if more remain.
 */
export const disableProChatsBatch = internalMutation({
  args: {
    userId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query("chats")
      .withIndex("by_user_subagent_override", (q) =>
        q.eq("userId", args.userId).eq("subagentOverride", "enabled"),
      )
      .take(DISABLE_PRO_CHAT_BATCH_SIZE);

    for (const chat of batch) {
      await ctx.db.patch(chat._id, {
        subagentOverride: undefined,
        updatedAt: args.now,
      });
    }

    // If the batch was full, there may be more. Schedule another pass.
    // Each patched chat is removed from the index, so subsequent passes
    // make forward progress with no wasted reads.
    if (batch.length === DISABLE_PRO_CHAT_BATCH_SIZE) {
      await ctx.scheduler.runAfter(
        0,
        internal.preferences.mutations.disableProChatsBatch,
        { userId: args.userId, now: args.now },
      );
    }
  },
});

/**
 * Sync a StoreKit 2 entitlement from the iOS client.
 *
 * Called after a successful purchase or when the transaction listener
 * detects a verified transaction on app launch. Client-side trust is
 * acceptable for launch — no server-side receipt validation.
 *
 * Idempotent: re-calling with the same originalTransactionId updates the
 * entitlement row without depending on mirrored preference fields.
 */
export const syncEntitlement = mutation({
  args: {
    originalTransactionId: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const now = Date.now();

    await upsertPurchaseEntitlement(ctx, {
      userId,
      externalPurchaseId: args.originalTransactionId,
      productId: "nanthai.pro",
      platform: "ios",
      source: "app_store",
      now,
      status: "active",
    });

    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!prefs) {
      return await ctx.db.insert("userPreferences", buildDefaultUserPreferencesInsert(userId, now) as any);
    }

    return prefs._id;
  },
});


/**
 * Sync an Android Play Billing entitlement from the Android client.
 *
 * The Android client is expected to pass the purchase token and product ID.
 * For the current tester flow we trust the verified client purchase and mark
 * the entitlement active immediately, while keeping `userPreferences` limited
 * to non-billing client state.
 */
export const syncPlayEntitlement = mutation({
  args: {
    purchaseToken: v.string(),
    productId: v.string(),
    environment: v.optional(v.string()),
    packageName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const now = Date.now();

    await upsertPurchaseEntitlement(ctx, {
      userId,
      externalPurchaseId: args.purchaseToken,
      productId: args.productId,
      platform: "android",
      source: "play_store",
      rawEnvironment: args.environment,
      metadata: args.packageName ? { packageName: args.packageName } : undefined,
      now,
      status: "active",
    });

    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!prefs) {
      return await ctx.db.insert("userPreferences", buildDefaultUserPreferencesInsert(userId, now) as any);
    }

    return prefs._id;
  },
});

/**
 * Revoke Android Play Billing entitlement.
 */
export const revokePlayEntitlement = mutation({
  args: {
    purchaseToken: v.string(),
    status: v.optional(v.union(v.literal("revoked"), v.literal("refunded"), v.literal("expired"))),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const now = Date.now();
    const status = args.status ?? "revoked";

    const entitlements = await ctx.db
      .query("purchaseEntitlements")
      .withIndex("by_external_purchase", (q) => q.eq("externalPurchaseId", args.purchaseToken))
      .collect();

    for (const entitlement of entitlements) {
      if (entitlement.userId !== userId || entitlement.source !== "play_store") {
        continue;
      }
      await ctx.db.patch(entitlement._id, {
        status,
        revokedAt: now,
        lastVerifiedAt: now,
        updatedAt: now,
      });
    }

    const stillActive = await ctx.db
      .query("purchaseEntitlements")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
      .first();

    if (!stillActive) {
      await disableProClientState(ctx, userId, now);
    }
  },
});

/**
 * Revoke a Pro entitlement (refund/revocation detected by StoreKit).
 *
 * Called from the iOS client when Transaction.revocationDate is set.
 * Only revokes the specific entitlement matching the given transaction ID
 * so that other app_store entitlements (if any) remain unaffected.
 */
export const revokeEntitlement = mutation({
  args: {
    originalTransactionId: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const now = Date.now();

    const entitlements = await ctx.db
      .query("purchaseEntitlements")
      .withIndex("by_external_purchase", (q) => q.eq("externalPurchaseId", args.originalTransactionId))
      .collect();

    for (const entitlement of entitlements) {
      if (entitlement.userId !== userId || entitlement.source !== "app_store") {
        continue;
      }
      await ctx.db.patch(entitlement._id, {
        status: "revoked",
        revokedAt: now,
        lastVerifiedAt: now,
        updatedAt: now,
      });
    }

    const stillActive = await ctx.db
      .query("purchaseEntitlements")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
      .first();

    if (!stillActive) {
      await disableProClientState(ctx, userId, now);
    }
  },
});

// -- Onboarding ---------------------------------------------------------------

/** Mark onboarding as completed for the authenticated user. */
export const setOnboardingCompleted = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const now = Date.now();

    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!prefs) {
      return await ctx.db.insert("userPreferences", {
        userId,
        sendOnEnter: true,
        showReasoning: true,
        hapticFeedback: true,
        appearanceMode: "light",
        pickerFilterFree: false,
        pickerFilterExcludeFree: false,
        pickerFilterVision: false,
        pickerFilterImageGen: false,
        pickerFilterTools: false,
        webSearchEnabledByDefault: true,
        subagentsEnabledByDefault: false,
        isMemoryEnabled: true,
        memoryGatingMode: "automatic",
        onboardingCompleted: true,
        updatedAt: now,
      });
    }

    if (!prefs.onboardingCompleted) {
      await ctx.db.patch(prefs._id, {
        onboardingCompleted: true,
        updatedAt: now,
      });
    }

    return prefs._id;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Manual Pro Entitlement (admin)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Grant Pro to a user manually (e.g. testers, partners, support comp).
 * Idempotent — skips if an active manual entitlement already exists.
 *
 * Run from Convex Dashboard:
 *   npx convex run preferences/mutations:grantManualPro '{"userId":"user_xxx","reason":"beta tester"}'
 */
export const grantManualPro = internalMutation({
  args: {
    userId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check for existing active manual entitlement
    const existing = await ctx.db
      .query("purchaseEntitlements")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", "active"),
      )
      .filter((q) => q.eq(q.field("source"), "manual"))
      .first();

    if (existing) return existing._id;

    const now = Date.now();
    const id = await ctx.db.insert("purchaseEntitlements", {
      userId: args.userId,
      platform: "web", // manual grants are platform-agnostic; "web" is the default
      source: "manual",
      productId: "nanthai_pro",
      externalPurchaseId: `manual_${args.userId}_${now}`,
      status: "active",
      activatedAt: now,
      lastVerifiedAt: now,
      updatedAt: now,
      metadata: args.reason ? { reason: args.reason } : undefined,
    });

    // Also ensure userPreferences exists
    await ctx.runMutation(internal.preferences.mutations.ensureUserPreferencesInternal, {
      userId: args.userId,
    });

    return id;
  },
});

/**
 * Revoke a manually granted Pro entitlement.
 *
 * Run from Convex Dashboard:
 *   npx convex run preferences/mutations:revokeManualPro '{"userId":"user_xxx"}'
 */
export const revokeManualPro = internalMutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const manualEntitlements = await ctx.db
      .query("purchaseEntitlements")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", "active"),
      )
      .filter((q) => q.eq(q.field("source"), "manual"))
      .collect();

    if (manualEntitlements.length === 0) {
      throw new ConvexError("No active manual entitlement found for this user");
    }

    for (const ent of manualEntitlements) {
      await ctx.db.patch(ent._id, {
        status: "revoked",
        revokedAt: now,
        updatedAt: now,
      });
    }

    return manualEntitlements.length;
  },
});
