import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { EXTERNAL_MCP_RESULT_SOURCE } from "../chat/external_content";
import { TERMINAL_GENERATION_JOB_STATUSES } from "../chat/generation_continuation_shared";
import { unnamedRecipients } from "../tools/confirmation_policy";
import { toolConfirmationTimeoutMs } from "./outcome";
import { toolConfirmationKind } from "./validators";

const USER_MESSAGE_SCAN_LIMIT = 500;

export const evaluateArgs = {
  userId: v.string(),
  chatId: v.id("chats"),
  messageId: v.id("messages"),
  userMessageId: v.optional(v.id("messages")),
  jobId: v.id("generationJobs"),
  attemptId: v.id("executionAttempts"),
  fence: v.number(),
  toolCallId: v.string(),
  toolName: v.string(),
  inputHash: v.string(),
  configuredAutomation: v.boolean(),
  confirmationAvailable: v.boolean(),
  candidate: v.object({
    kind: toolConfirmationKind,
    summary: v.string(),
    detail: v.optional(v.string()),
    recipients: v.array(v.string()),
    integrations: v.array(v.string()),
  }),
};

export type EvaluateArgs = {
  userId: string;
  chatId: Id<"chats">;
  messageId: Id<"messages">;
  userMessageId?: Id<"messages">;
  jobId: Id<"generationJobs">;
  attemptId: Id<"executionAttempts">;
  fence: number;
  toolCallId: string;
  toolName: string;
  inputHash: string;
  configuredAutomation: boolean;
  confirmationAvailable: boolean;
  candidate: {
    kind: Doc<"toolConfirmationRequests">["kind"];
    summary: string;
    detail?: string;
    recipients: string[];
    integrations: string[];
  };
};

export const gateDecision = v.union(
  v.object({ decision: v.literal("proceed") }),
  v.object({
    decision: v.literal("deny"),
    reason: v.union(v.literal("non_interactive"), v.literal("unavailable"), v.literal("declined")),
  }),
  v.object({ decision: v.literal("defer"), confirmationId: v.string() }),
);

export type GateDecision =
  | { decision: "proceed" }
  | { decision: "deny"; reason: "non_interactive" | "unavailable" | "declined" }
  | { decision: "defer"; confirmationId: string };

export async function userAuthoredTexts(ctx: MutationCtx, chatId: Id<"chats">): Promise<string[]> {
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .order("desc")
    .take(USER_MESSAGE_SCAN_LIMIT);
  return messages
    .filter((message) => message.role === "user"
      && message.source !== "scheduled_step"
      && message.source !== EXTERNAL_MCP_RESULT_SOURCE
      && message.turnOrigin !== "external_mcp")
    .map((message) => message.content ?? "");
}

async function isInteractiveTurn(ctx: MutationCtx, args: EvaluateArgs): Promise<boolean> {
  if (!args.confirmationAvailable || args.configuredAutomation) return false;
  if (!args.userMessageId) return false;
  const userMessage = await ctx.db.get(args.userMessageId);
  if (!userMessage || userMessage.chatId !== args.chatId) return false;
  return userMessage.source !== "scheduled_step" && userMessage.turnOrigin === undefined;
}

export async function evaluateToolConfirmationHandler(
  ctx: MutationCtx,
  args: EvaluateArgs,
  now = Date.now(),
): Promise<GateDecision> {
  const job = await ctx.db.get(args.jobId);
  if (
    !job
    || job.userId !== args.userId
    || job.chatId !== args.chatId
    || TERMINAL_GENERATION_JOB_STATUSES.has(job.status)
    || job.executionAttemptId !== args.attemptId
    || job.executionFence !== args.fence
  ) return { decision: "deny", reason: "unavailable" };

  if (args.candidate.kind === "external_send" && args.candidate.recipients.length > 0) {
    const unnamed = unnamedRecipients(args.candidate.recipients, await userAuthoredTexts(ctx, args.chatId));
    if (unnamed.length === 0) return { decision: "proceed" };
  }

  const grant = (await ctx.db
    .query("toolConfirmationRequests")
    .withIndex("by_job_grant", (q) => q
      .eq("generationJobId", args.jobId)
      .eq("toolName", args.toolName)
      .eq("inputHash", args.inputHash)
      .eq("status", "approved"))
    .collect())
    .find((row) => row.userId === args.userId
      && row.grantConsumedAt === undefined
      && (row.grantExpiresAt ?? 0) > now);
  if (grant) {
    await ctx.db.patch(grant._id, { grantConsumedAt: now, updatedAt: now });
    return { decision: "proceed" };
  }

  if (!await isInteractiveTurn(ctx, args)) return { decision: "deny", reason: "non_interactive" };

  const existing = await ctx.db
    .query("toolConfirmationRequests")
    .withIndex("by_job_tool_call", (q) => q.eq("generationJobId", args.jobId).eq("toolCallId", args.toolCallId))
    .first();
  if (existing && existing.inputHash === args.inputHash) {
    if (existing.status === "pending") return { decision: "defer", confirmationId: String(existing._id) };
    return { decision: "deny", reason: "declined" };
  }

  const prefs = await ctx.db
    .query("userPreferences")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .first();
  const expiresAt = now + toolConfirmationTimeoutMs(prefs?.localQuestionTimeoutMinutes);
  const confirmationId = await ctx.db.insert("toolConfirmationRequests", {
    userId: args.userId,
    chatId: args.chatId,
    messageId: args.messageId,
    generationJobId: args.jobId,
    ...(job.executionRunId ? { runId: job.executionRunId } : {}),
    attemptId: args.attemptId,
    fence: args.fence,
    toolCallId: args.toolCallId,
    toolName: args.toolName,
    inputHash: args.inputHash,
    kind: args.candidate.kind,
    summary: args.candidate.summary,
    ...(args.candidate.detail ? { detail: args.candidate.detail } : {}),
    recipients: args.candidate.recipients,
    integrations: args.candidate.integrations,
    status: "pending",
    checkpointBound: false,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAt(expiresAt, internal.tool_confirmations.mutations.expire, { confirmationId });
  return { decision: "defer", confirmationId: String(confirmationId) };
}

export const evaluate = internalMutation({
  args: evaluateArgs,
  returns: gateDecision,
  handler: async (ctx, args) => await evaluateToolConfirmationHandler(ctx, args),
});
