import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { PendingToolConfirmation } from "./validators";

export function projectPendingToolConfirmation(
  request: Doc<"toolConfirmationRequests">,
): PendingToolConfirmation {
  return {
    confirmationId: String(request._id),
    kind: request.kind,
    toolName: request.toolName,
    summary: request.summary,
    ...(request.detail ? { detail: request.detail } : {}),
    recipients: request.recipients,
    integrations: request.integrations,
    expiresAt: request.expiresAt,
    createdAt: request.createdAt,
  };
}

/** Oldest pending confirmation per owning run for one chat. */
export async function pendingConfirmationsByRun(
  ctx: QueryCtx,
  userId: string,
  chatId: Id<"chats">,
): Promise<Map<string, PendingToolConfirmation>> {
  const pending = await ctx.db
    .query("toolConfirmationRequests")
    .withIndex("by_user_chat_status", (q) => q.eq("userId", userId).eq("chatId", chatId).eq("status", "pending"))
    .order("asc")
    .take(20);
  const byRun = new Map<string, PendingToolConfirmation>();
  for (const request of pending) {
    if (!request.runId || !request.checkpointBound || byRun.has(String(request.runId))) continue;
    byRun.set(String(request.runId), projectPendingToolConfirmation(request));
  }
  return byRun;
}
