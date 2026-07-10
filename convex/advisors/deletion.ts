import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { cancelAdvisorBatchRows } from "./lifecycle";
import { deleteAdvisorRunAndReclaimAvatar } from "./avatar_storage";

/** Keep Advisor history references coherent when a single transcript node is deleted. */
export async function deleteAdvisorDataForMessage(
  ctx: MutationCtx,
  message: Doc<"messages">,
): Promise<void> {
  const batches = new Map<string, Doc<"advisorBatches">>();
  if (message.advisorBatchId) {
    const direct = await ctx.db.get(message.advisorBatchId);
    if (direct) batches.set(String(direct._id), direct);
  }
  const owned = await ctx.db
    .query("advisorBatches")
    .withIndex("by_user_message", (query) => query.eq("userMessageId", message._id))
    .collect();
  for (const batch of owned) batches.set(String(batch._id), batch);

  for (const batch of batches.values()) {
    const linkedMessages = await ctx.db
      .query("messages")
      .withIndex("by_advisor_batch", (query) => query.eq("advisorBatchId", batch._id))
      .collect();
    const survivingLinkedAssistantIds = linkedMessages
      .filter((linkedMessage) => linkedMessage._id !== message._id && linkedMessage.role === "assistant")
      .map((linkedMessage) => linkedMessage._id);
    const remainingAssistantIds = [
      ...batch.assistantMessageIds.filter((id) => id !== message._id),
      ...survivingLinkedAssistantIds.filter((id) =>
        !batch.assistantMessageIds.some((batchId) => batchId === id)
      ),
    ];
    if (batch.userMessageId !== message._id && remainingAssistantIds.length > 0) {
      await ctx.db.patch(batch._id, {
        assistantMessageIds: remainingAssistantIds,
        updatedAt: Date.now(),
      });
      continue;
    }
    await cancelAdvisorBatchRows(ctx, batch);
    const runs = await ctx.db
      .query("advisorRuns")
      .withIndex("by_batch", (query) => query.eq("batchId", batch._id))
      .collect();
    for (const run of runs) await deleteAdvisorRunAndReclaimAvatar(ctx, run);
    for (const linkedMessage of linkedMessages) {
      if (linkedMessage._id !== message._id) {
        await ctx.db.patch(linkedMessage._id, { advisorBatchId: undefined });
      }
    }
    await ctx.db.delete(batch._id);
  }
}
