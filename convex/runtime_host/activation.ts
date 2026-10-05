import { ConvexError } from "convex/values";
import { mutation, query, type MutationCtx } from "../_generated/server";
import { provisionStarterPersona } from "./starter_persona";
import { requireAuth, requirePro, optionalAuth } from "../lib/auth";

/** Explicit setup intent opens the web controller, without claiming a working route. */
export const begin = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const prefs = await ctx.db.query("userPreferences").withIndex("by_user", (q) => q.eq("userId", userId)).first();
    if (!prefs) throw new ConvexError({ code: "NOT_FOUND", message: "Onboarding preferences are not ready. Reload and retry." });
    const now = Date.now();
    if (!prefs.runtimeOnboardingState) await ctx.db.patch(prefs._id, { runtimeOnboardingState: "setup", updatedAt: now });
    // Resume already-paired setup immediately; other hosts provision on their normal heartbeat.
    const devices = await ctx.db.query("runtimeDevices")
      .withIndex("by_user_status", q => q.eq("userId", userId).eq("status", "active"))
      .take(32);
    for (const device of devices) await provisionStarterPersona(ctx, device, now);
  },
});

/** Called inside the fenced successful local-turn commit, never from presence or pairing. */
export async function completeLocalActivation(ctx: MutationCtx, userId: string): Promise<void> {
  const prefs = await ctx.db.query("userPreferences").withIndex("by_user", (q) => q.eq("userId", userId)).first();
  if (prefs && prefs.runtimeOnboardingState !== "ready") {
    await ctx.db.patch(prefs._id, { runtimeOnboardingState: "ready", onboardingCompleted: true, updatedAt: Date.now() });
  }
}

/** Persisted setup intent/activation keeps every controller usable while its computer is offline. */
export const canUseLocalController = query({
  args: {},
  handler: async (ctx) => {
    const auth = await optionalAuth(ctx);
    if (!auth) return false;
    const prefs = await ctx.db.query("userPreferences").withIndex("by_user", q => q.eq("userId", auth.userId)).first();
    return prefs?.runtimeOnboardingState === "setup" || prefs?.runtimeOnboardingState === "ready";
  },
});
