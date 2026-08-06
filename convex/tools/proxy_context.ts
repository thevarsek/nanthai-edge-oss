import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { presentationContextValidator } from "../presentations/validators";
import type { PresentationToolContext, ToolExecutionContext } from "./registry";

export type SerializableToolContext = {
  userId: string;
  chatId?: string;
  messageId?: string;
  userMessageId?: string;
  presentationContext?: PresentationToolContext;
  jobId?: string;
  generationKey?: string;
  modelId?: string;
  requireZdr?: boolean;
  providerDeadlineAtMs?: number;
};

export function serializableToolContext(
  toolCtx: ToolExecutionContext,
): SerializableToolContext {
  const context: SerializableToolContext = {
    userId: toolCtx.userId,
  };
  if (toolCtx.chatId !== undefined) context.chatId = toolCtx.chatId;
  if (toolCtx.messageId !== undefined) context.messageId = toolCtx.messageId;
  if (toolCtx.userMessageId !== undefined) context.userMessageId = toolCtx.userMessageId;
  if (toolCtx.presentationContext !== undefined) {
    context.presentationContext = {
      ...toolCtx.presentationContext,
      projectId: toolCtx.presentationContext.projectId as Id<"presentationProjects">,
    };
  }
  if (toolCtx.jobId !== undefined) context.jobId = toolCtx.jobId;
  if (toolCtx.generationKey !== undefined) {
    context.generationKey = toolCtx.generationKey;
  }
  if (toolCtx.modelId !== undefined) context.modelId = toolCtx.modelId;
  if (toolCtx.requireZdr !== undefined) context.requireZdr = toolCtx.requireZdr;
  if (toolCtx.providerDeadlineAtMs !== undefined) {
    context.providerDeadlineAtMs = toolCtx.providerDeadlineAtMs;
  }
  return context;
}

export const serializableToolContextValidator = v.object({
  userId: v.string(),
  chatId: v.optional(v.string()),
  messageId: v.optional(v.string()),
  userMessageId: v.optional(v.string()),
  presentationContext: v.optional(presentationContextValidator),
  jobId: v.optional(v.string()),
  generationKey: v.optional(v.string()),
  modelId: v.optional(v.string()),
  requireZdr: v.optional(v.boolean()),
  providerDeadlineAtMs: v.optional(v.number()),
});
