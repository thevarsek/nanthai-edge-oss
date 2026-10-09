import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { affectedDependents, type WorkDependencyNode } from "./work_policy";

export function workError(message: string): never {
  throw new ConvexError({ code: "VALIDATION", message });
}
export async function requireWorkChat(
  ctx: QueryCtx | MutationCtx, userId: string, chatId: Id<"chats">,
) {
  const chat = await ctx.db.get(chatId);
  if (!chat || chat.userId !== userId || chat.isDeleting) workError("Chat not found.");
  return chat;
}
export async function requireWork(
  ctx: MutationCtx, userId: string, workId: Id<"collaborationWork">, revision: number,
) {
  const work = await ctx.db.get(workId);
  if (!work || work.userId !== userId) workError("Work record not found.");
  await requireWorkChat(ctx, userId, work.chatId);
  if (work.revision !== revision) workError("This work record changed. Refresh before editing.");
  return work;
}
export async function validateWorkParticipants(
  ctx: MutationCtx, userId: string, chatId: Id<"chats">,
  ids: Id<"chatParticipants">[],
) {
  for (const id of new Set(ids)) {
    const participant = await ctx.db.get(id);
    if (!participant || participant.userId !== userId || participant.chatId !== chatId) {
      workError("Choose a current participant in this conversation.");
    }
  }
}
export function dependencyNodes(rows: Doc<"collaborationWork">[]): WorkDependencyNode[] {
  return rows.map((row) => ({
    id: String(row._id), dependencyIds: row.dependencyIds.map(String),
    status: row.status, needsRevalidation: row.needsRevalidation,
  }));
}
export async function invalidateDependents(ctx: MutationCtx, work: Doc<"collaborationWork">) {
  const rows = await ctx.db.query("collaborationWork")
    .withIndex("by_chat", (q) => q.eq("chatId", work.chatId)).collect();
  const affected = new Set(affectedDependents(dependencyNodes(rows), String(work._id)));
  for (const row of rows) {
    if (!affected.has(String(row._id)) || row.status === "cancelled") continue;
    await ctx.db.patch(row._id, {
      needsRevalidation: true, revision: row.revision + 1,
      status: row.status === "done" ? "review" : row.status, updatedAt: Date.now(),
    });
  }
}
