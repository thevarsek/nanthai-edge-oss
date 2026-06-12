import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

export type ContextAssemblyLogPayload = Omit<
  Doc<"contextAssemblyLogs">,
  "_id" | "_creationTime" | "createdAt"
>;

export async function scheduleContextAssemblyLog(
  ctx: Pick<ActionCtx, "scheduler">,
  payload: ContextAssemblyLogPayload,
): Promise<void> {
  try {
    await ctx.scheduler.runAfter(
      0,
      internal.chat.context_assembly_logs.insertContextAssemblyLog,
      payload,
    );
  } catch (error) {
    console.warn("[context-assembly] failed to schedule assembly log", {
      chatId: payload.chatId,
      messageId: payload.messageId,
      jobId: payload.jobId,
      runtimeKind: payload.runtimeKind ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
