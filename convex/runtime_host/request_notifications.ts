import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/** Called once, only when the canonical request is first inserted. */
export async function notifyRuntimeRequest(ctx: MutationCtx, userId: string, chatId: Id<"chats">): Promise<void> {
  const prefs = await ctx.db.query("userPreferences").withIndex("by_user", q => q.eq("userId", userId)).first();
  if (prefs?.chatCompletionNotificationsEnabled !== true) return;
  await ctx.scheduler.runAfter(0, internal.push.actions.sendPushNotification, {
    userId, chatId: String(chatId), title: "Response needed",
    body: "Open NanthAI to answer a local runtime request.", category: "runtime_input",
  });
}
