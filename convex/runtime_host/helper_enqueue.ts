import { ConvexError } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { OpenRouterMessage } from "../lib/openrouter";
import { internal } from "../_generated/api";

export async function enqueueLocalHelperAfterMissingKey(
  ctx: ActionCtx,
  error: unknown,
  args: { userId: string; chatId: Id<"chats"> } & Record<string, unknown>,
  messageId: Id<"messages"> | undefined,
  purpose: "memory" | "title" | "forget",
  messages: OpenRouterMessage[],
): Promise<boolean> {
  if (!(error instanceof ConvexError) || error.data?.code !== "MISSING_API_KEY" || !messageId) return false;
  return Boolean(await ctx.runMutation(internal.runtime_host.helper_tasks.start, {
    userId: args.userId, chatId: args.chatId, messageId, purpose, input: JSON.stringify(args),
    messages: messages.map(message => ({ role: message.role, content: String(message.content) })),
  }));
}
