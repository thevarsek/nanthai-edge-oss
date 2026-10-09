import { v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { requireAuth, requirePro } from "../lib/auth";
import { createCollaborationExchange, findActiveCollaborationExchange } from "./creation";
import { requireWorkChat, workError } from "./work_helpers";
import { activateWorkScope } from "./work_scope";
import { wakeCollaboration } from "./wake_events";

export async function startWorkRun(ctx: MutationCtx, userId: string, chatId: Id<"chats">, workId?: Id<"collaborationWork">) {
  const chat = await requireWorkChat(ctx, userId, chatId);
  const rows = await ctx.db.query("collaborationWork").withIndex("by_chat", q => q.eq("chatId", chatId)).collect();
  const pending = rows.filter(row => row.status !== "done" && row.status !== "cancelled");
  if (!pending.length || (workId && !pending.some(row => row._id === workId))) workError("There are no remaining goals to resume.");
  const workIds = await activateWorkScope(ctx, rows, workId ? [workId] : pending.map(row => row._id));
  const work = pending.filter(row => workIds.includes(row._id));
  const active = await findActiveCollaborationExchange(ctx, chatId);
  if (active) {
    const previousIds = active.workIds ?? rows.filter(row => row.deferred !== true).map(row => row._id);
    await ctx.db.patch(active._id, { workEnabled: true, workIds: [...new Set([...previousIds, ...workIds])] });
    await wakeCollaboration(ctx, active._id); return active._id;
  }
  const [participants, previous] = await Promise.all([
    ctx.db.query("chatParticipants").withIndex("by_chat", q => q.eq("chatId", chatId)).collect(),
    ctx.db.query("collaborationExchanges").withIndex("by_chat", q => q.eq("chatId", chatId)).order("desc").first(),
  ]);
  if (participants.some(row => row.personaId)) await requirePro(ctx, userId);
  const now = Date.now();
  const messageId = await ctx.db.insert("messages", {
    userId, chatId, role: "system", collaborationGoalAction: "start_or_resume", content: `Goals started or resumed:\n${work.map(row => row.objective).join("\n")}`,
    parentMessageIds: previous?.frontierMessageIds ?? (chat.activeBranchLeafId ? [chat.activeBranchLeafId] : []),
    status: "completed", createdAt: now,
  });
  const exchangeId = await createCollaborationExchange(ctx, {
    userId, chatId, initiatingMessageId: messageId, now, workIds,
    participants: participants.map(row => ({ participantKey: String(row._id), modelId: row.modelId, personaId: row.personaId })),
    generationSnapshot: previous?.generationSnapshot ?? { expandMultiModelGroups: true, webSearchEnabled: false },
  });
  await ctx.db.patch(messageId, { collaborationExchangeId: exchangeId });
  await ctx.db.patch(chatId, { groupBehavior: "collaboration", activeBranchLeafId: messageId,
    messageCount: (chat.messageCount ?? 0) + 1, lastMessageDate: now, updatedAt: now });
  await ctx.scheduler.runAfter(0, internal.collaboration.workflow_start.startExchange, { exchangeId });
  return exchangeId;
}
export const continueWork = mutation({
  args: { chatId: v.id("chats"), workId: v.optional(v.id("collaborationWork")) }, returns: v.id("collaborationExchanges"),
  handler: async (ctx, { chatId, workId }) => { const { userId } = await requireAuth(ctx); return await startWorkRun(ctx, userId, chatId, workId); },
});
