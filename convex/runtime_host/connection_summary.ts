import { resolveQuestionTimeout, questionTimeoutMinutes } from "./question_policy";
import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";

/** Shared status for the three Settings clients; pairing and readiness are distinct. */
export const getMySummary = query({
  args: {},
  returns: v.object({
    status: v.union(v.literal("not_paired"), v.literal("offline"), v.literal("online"), v.literal("needs_attention")),
    pairedCount: v.number(), readyCount: v.number(), deviceName: v.union(v.string(), v.null()),
    setupPending: v.boolean(),
    questionTimeoutMinutes,
    downloadUrl: v.union(v.string(), v.null()),
  }),
  handler: async ctx => {
    const { userId } = await requireAuth(ctx);
    const prefs = await ctx.db.query("userPreferences").withIndex("by_user", q => q.eq("userId", userId)).first();
    const devices = await ctx.db.query("runtimeDevices").withIndex("by_user_status", q => q.eq("userId", userId).eq("status", "active")).collect();
    const presences = await Promise.all(devices.map(device => device.currentPresenceId ? ctx.db.get(device.currentPresenceId) : null));
    const online = devices.filter((_, index) => presences[index]?.status === "online" && (presences[index]?.expiresAt ?? 0) > Date.now());
    const ready = devices.filter((_, index) => presences[index]?.status === "online" && (presences[index]?.expiresAt ?? 0) > Date.now()
      && presences[index]?.adapters.some(adapter => adapter.authState === "ready"));
    return { status: ready.length ? "online" as const : online.length ? "needs_attention" as const : devices.length ? "offline" as const : "not_paired" as const,
      pairedCount: devices.length, readyCount: ready.length, deviceName: (ready[0] ?? online[0] ?? devices[0])?.displayName ?? null,
      setupPending: prefs?.runtimeOnboardingState === "setup" && !prefs.onboardingCompleted,
      questionTimeoutMinutes: resolveQuestionTimeout(prefs?.localQuestionTimeoutMinutes),
      downloadUrl: process.env.NANTHAI_RUNTIME_HOST_DOWNLOAD_URL ?? null };
  },
});
