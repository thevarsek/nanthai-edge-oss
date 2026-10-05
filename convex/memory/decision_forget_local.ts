import { z } from "zod";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { forgetDecisionRequest, memoryScopeSnapshot, projectForgetTarget } from "./decision_forget";
import type { MemoryHelperExecution } from "./helper_write_fence";
import type { DecisionResult } from "../decisions/client";

const inputSchema = z.object({
  userId: z.string(), chatId: z.string(), userMessageId: z.string(), userMessageContent: z.string(),
  candidates: z.array(z.object({
    _id: z.string(), content: z.string(), updatedAt: z.number(),
    scopeType: z.string().optional(), personaIds: z.array(z.string()).optional(),
  }).passthrough()).min(1).max(12),
});
const answersSchema = z.object({ answers: z.record(z.string(), z.object({
  type: z.literal("choice"), choice: z.enum(["forget", "preserve", "uncertain"]),
}).strict()) }).strict();

export function parseLocalForget(content: string, keys: string[]): DecisionResult {
  const response = answersSchema.parse(JSON.parse(content.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")));
  if (Object.keys(response.answers).length !== keys.length || keys.some(key => !response.answers[key])) throw new Error("LOCAL_FORGET_ANSWER_MISMATCH");
  return { answers: response.answers, modelId: "gpt-6-luna", durationMs: 0 };
}

export async function consumeLocalForget(ctx: ActionCtx, input: string, content: string, execution: MemoryHelperExecution): Promise<void> {
  const args = inputSchema.parse(JSON.parse(input));
  // Keep the dispatched candidate order and commit only if that exact memory/evidence is unchanged.
  const request = forgetDecisionRequest(args.userMessageContent, args.candidates);
  const result = parseLocalForget(content, Object.keys(request.questions));
  const target = projectForgetTarget(result, args.candidates);
  if (!target) return;
  await ctx.runMutation(internal.memory.decision_forget.commitForget, {
    userId: args.userId, chatId: args.chatId as Id<"chats">, messageId: args.userMessageId as Id<"messages">,
    evidence: args.userMessageContent, memoryId: target._id as Id<"memories">,
    content: target.content, updatedAt: target.updatedAt as number, scopeSnapshot: memoryScopeSnapshot(target), ...execution,
  });
}
