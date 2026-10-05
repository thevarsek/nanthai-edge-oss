import { ConvexError, v } from "convex/values";
import type { Doc, Id, TableNames } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import { createChatHandler, sendMessageHandler, cancelGenerationHandler } from "../chat/mutations_public_handlers";
import { listChatsHandler } from "../chat/queries_handlers_public";
import { listMessagesHandler } from "../chat/queries_message_handlers";
import { getGeneratedFilesByMessageHandler } from "../chat/queries_generated_files_handlers";
import { ensureGeneratedFileRow } from "../chat/generated_file_registration";
import { resolveParentMessageIdsForSend } from "../chat/mutation_send_helpers";
import { listMyRunProjectionsHandler } from "../execution/queries";
import { closeRunWriterForCancellation } from "../execution/cancel_fence";
import { runJobNowHandler } from "../scheduledJobs/run_now";
import { personaRuntimeIdentity } from "../runtime_host/identity_projection";
import { sha256Hex } from "../runtime_host/security";
import { MODEL_IDS } from "../lib/model_constants";
import { authenticateGrant, grantedContext } from "./policy";
import { findTool, toolsForScopes } from "./tools";

const args = { accessToken: v.string(), tool: v.string(), inputJson: v.string() };
function notFound(): never { throw new ConvexError({ code: "NOT_FOUND", message: "Item not found in this account" }); }
function id<T extends TableNames>(ctx: QueryCtx, table: T, raw: unknown): Id<T> {
  const parsed = typeof raw === "string" ? ctx.db.normalizeId(table, raw) : null;
  if (!parsed) notFound();
  return parsed;
}
async function ownedChat(ctx: QueryCtx, userId: string, raw: unknown) {
  const chat = await ctx.db.get(id(ctx, "chats", raw));
  if (!chat || chat.userId !== userId || chat.isDeleting) notFound();
  return chat;
}
export const discover = internalQuery({ args: { accessToken: v.string() }, handler: async (ctx, args) => {
  const grant = await authenticateGrant(ctx, args.accessToken);
  // JSON Schema uses reserved Convex keys such as $schema and $defs.
  return JSON.stringify(toolsForScopes(grant.accessScopes));
} });

export const read = internalQuery({ args, handler: async (ctx, args) => {
  const tool = findTool(args.tool);
  if (!tool?.readOnly) throw new ConvexError({ code: "INVALID_TOOL", message: "Unknown read tool" });
  const input = tool.schema.parse(JSON.parse(args.inputJson)) as Record<string, unknown>;
  const grant = await authenticateGrant(ctx, args.accessToken, tool.scope);
  const account = grantedContext(ctx, grant.userId);
  let result: unknown;
  if (tool.name === "nanthai_list_chats") {
    result = await listChatsHandler(account, { searchQuery: input.searchQuery as string | undefined, limit: input.limit as number | undefined });
  } else if (tool.name === "nanthai_read_chat") {
    const chat = await ownedChat(ctx, grant.userId, input.chatId);
    result = { chatId: chat._id, title: chat.title,
      messages: await listMessagesHandler(account, { chatId: chat._id, before: input.before as number | undefined, limit: input.limit as number | undefined }),
      runs: await listMyRunProjectionsHandler(account, { chatId: chat._id }) };
  } else if (tool.name === "nanthai_read_artifacts") {
    const message = await ctx.db.get(id(ctx, "messages", input.messageId));
    if (!message) notFound();
    await ownedChat(ctx, grant.userId, message.chatId);
    result = await getGeneratedFilesByMessageHandler(account, { messageId: message._id });
  } else if (tool.name === "nanthai_list_personas") {
    const personas = await ctx.db.query("personas").withIndex("by_user", q => q.eq("userId", grant.userId)).collect();
    result = await Promise.all(personas.map(async persona => ({ id: persona._id, name: persona.displayName,
      modelId: persona.modelId, ...await personaRuntimeIdentity(ctx, persona) })));
  } else {
    const jobs = await ctx.db.query("scheduledJobs").withIndex("by_user", q => q.eq("userId", grant.userId)).collect();
    result = jobs.filter(job => !job.isDeleting).map(job => ({ id: job._id, name: job.name, status: job.status, recurrence: job.recurrence }));
  }
  return JSON.stringify(result);
} });

export function replayReceipt(receipt: Pick<Doc<"externalMcpReceipts">, "tool" | "inputHash" | "resultJson"> | null, tool: string, inputHash: string): string | null {
  if (!receipt) return null;
  if (receipt.tool !== tool || receipt.inputHash !== inputHash) throw new ConvexError({ code: "CONFLICT", message: "This operation ID already has different arguments" });
  return receipt.resultJson;
}
export const write = internalMutation({ args: { ...args, storageId: v.optional(v.id("_storage")) }, handler: async (ctx, args) => {
  const tool = findTool(args.tool);
  if (!tool || tool.readOnly) throw new ConvexError({ code: "INVALID_TOOL", message: "Unknown write tool" });
  const input = tool.schema.parse(JSON.parse(args.inputJson)) as Record<string, unknown>;
  const grant = await authenticateGrant(ctx, args.accessToken, tool.scope);
  const account = grantedContext(ctx, grant.userId);
  const callId = String(input.callId);
  const inputHash = await sha256Hex(JSON.stringify(input));
  const receipt = await ctx.db.query("externalMcpReceipts").withIndex("by_call", q => q.eq("grantId", grant._id).eq("callId", callId)).unique();
  const replay = replayReceipt(receipt, tool.name, inputHash);
  if (replay !== null) {
    if (args.storageId) await ctx.storage.delete(args.storageId);
    return replay;
  }
  let result: unknown;
  if (tool.name === "nanthai_create_chat") {
    const persona = await ctx.db.get(id(ctx, "personas", input.personaId));
    if (!persona || persona.userId !== grant.userId) notFound();
    const chatId = await createChatHandler(account, { mode: "chat", title: input.title as string | undefined,
      participants: [{ modelId: persona.modelId ?? MODEL_IDS.appDefault, personaId: persona._id, personaName: persona.displayName }] });
    result = { chatId };
  } else if (tool.name === "nanthai_send_message") {
    const chat = await ownedChat(ctx, grant.userId, input.chatId);
    const participants = await ctx.db.query("chatParticipants").withIndex("by_chat", q => q.eq("chatId", chat._id)).collect();
    result = await sendMessageHandler(account, { chatId: chat._id, text: String(input.text), participants: participants.map(participant => ({
      participantKey: String(participant._id), modelId: participant.modelId, personaId: participant.personaId,
      personaName: participant.personaName, temperature: participant.temperature, maxTokens: participant.maxTokens,
      includeReasoning: participant.includeReasoning, reasoningEffort: participant.reasoningEffort,
    })) });
  } else if (tool.name === "nanthai_run_job") {
    result = await runJobNowHandler(account, { jobId: id(ctx, "scheduledJobs", input.jobId) });
  } else if (tool.name === "nanthai_stop_run") {
    const run = await ctx.db.get(id(ctx, "executionRuns", input.runId));
    if (!run || run.userId !== grant.userId) notFound();
    if (run.generationJobId) await cancelGenerationHandler(account, { jobId: run.generationJobId });
    else if (!["completed", "failed", "cancelled"].includes(run.state)) {
      await closeRunWriterForCancellation(ctx, run._id, grant.userId, "Stopped through external MCP");
      await ctx.scheduler.runAfter(0, internal.execution.teardown.cancelRunTree, { runId: run._id, requestedBy: grant.userId, reason: "Stopped through external MCP" });
    }
    result = { runId: run._id, stopped: true };
  } else {
    const chat = await ownedChat(ctx, grant.userId, input.chatId);
    if (!args.storageId) throw new Error("PUBLICATION_STORAGE_MISSING");
    const metadata = await ctx.storage.getMetadata(args.storageId);
    if (!metadata || metadata.size > 512_000) throw new Error("PUBLICATION_STORAGE_INVALID");
    const parentMessageIds = await resolveParentMessageIdsForSend(ctx, {
      chatId: chat._id, activeBranchLeafId: chat.activeBranchLeafId, expandMultiModelGroups: true,
    });
    const messageId = await ctx.db.insert("messages", { chatId: chat._id, userId: grant.userId,
      role: "user", content: `${grant.name} · ${String(input.filename)}\n\n${String(input.content)}`, parentMessageIds, status: "completed", createdAt: Date.now() });
    const file = await ensureGeneratedFileRow(ctx, { userId: grant.userId, chatId: chat._id, messageId,
      file: { storageId: args.storageId, filename: String(input.filename), mimeType: String(input.mimeType), sizeBytes: metadata.size, toolName: tool.name } });
    await ctx.db.patch(messageId, { generatedFileIds: [file.id] });
    await ctx.db.patch(chat._id, { activeBranchLeafId: messageId, updatedAt: Date.now() });
    result = { chatId: chat._id, messageId, generatedFileId: file.id, filename: input.filename };
  }
  const resultJson = JSON.stringify(result ?? null);
  await ctx.db.insert("externalMcpReceipts", { userId: grant.userId, grantId: grant._id, callId, tool: tool.name, inputHash, resultJson, createdAt: Date.now() });
  return resultJson;
} });
