import { v } from "convex/values";
import type { ToolExecutionContext } from "./registry";

export type SerializableToolContext = {
  userId: string;
  chatId?: string;
  messageId?: string;
  jobId?: string;
  generationKey?: string;
  modelId?: string;
  requireZdr?: boolean;
};

export function serializableToolContext(
  toolCtx: ToolExecutionContext,
): SerializableToolContext {
  const context: SerializableToolContext = {
    userId: toolCtx.userId,
  };
  if (toolCtx.chatId !== undefined) context.chatId = toolCtx.chatId;
  if (toolCtx.messageId !== undefined) context.messageId = toolCtx.messageId;
  if (toolCtx.jobId !== undefined) context.jobId = toolCtx.jobId;
  if (toolCtx.generationKey !== undefined) {
    context.generationKey = toolCtx.generationKey;
  }
  if (toolCtx.modelId !== undefined) context.modelId = toolCtx.modelId;
  if (toolCtx.requireZdr !== undefined) context.requireZdr = toolCtx.requireZdr;
  return context;
}

export const serializableToolContextValidator = v.object({
  userId: v.string(),
  chatId: v.optional(v.string()),
  messageId: v.optional(v.string()),
  jobId: v.optional(v.string()),
  generationKey: v.optional(v.string()),
  modelId: v.optional(v.string()),
  requireZdr: v.optional(v.boolean()),
});
