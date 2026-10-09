import { notifyChannelInput } from "../channels/publication";
import { automaticQuestionContent, resolveQuestionTimeout } from "./question_policy";
import { continueQuestionRef } from "./question_automation";
import { notifyRuntimeRequest } from "./request_notifications";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { encryptSecret, decryptSecret, mutationSafeNonce, type SecretContext } from "../lib/secret_crypto";
import { sha256Hex } from "./security";
import { inspectPermissionRuntime } from "./permission_live_context";
import { enqueueRuntimeHostCommand } from "./command_transport";
import { validateRuntimeInput } from "./input_form";
import type { RuntimeRequestEventContext } from "./request_event_context";
import type { NonTerminalAdapterEvent } from "./protocol_adapter_events";

type InputEvent = Extract<NonTerminalAdapterEvent, { type: "input_requested" | "input_resolved" }>;
const secretContext = (command: Pick<Doc<"runtimeCommands">, "userId" | "attemptId" | "commandId">): SecretContext => ({
  namespace: "runtimeInput", userId: command.userId, attemptId: String(command.attemptId), requestId: command.commandId, field: "credentialValue",
});
export async function decryptRuntimeInputPayload(command: Doc<"runtimeCommands">): Promise<string | undefined> {
  return command.payload?.startsWith("enc:v2:") ? await decryptSecret(command.payload, secretContext(command)) : command.payload;
}
export async function recordRuntimeInputEvent(ctx: MutationCtx, context: RuntimeRequestEventContext, event: InputEvent): Promise<void> {
  const requests = await ctx.db.query("runtimePermissionRequests").withIndex("by_attempt_request", q => q.eq("attemptId", context.attempt._id).eq("permissionRequestId", event.inputRequestId)).collect();
  if (event.type === "input_requested") {
    if (requests.some(request => request.requestEventId === event.eventId)) return;
    if (requests.some(request => ["pending", "responding"].includes(request.status))) throw new Error("RUNTIME_INPUT_REQUEST_CONFLICT");
    if (context.attempt.status !== "running") throw new Error("RUNTIME_INPUT_ATTEMPT_INACTIVE");
    const now = Date.now();
    const inputSchema = JSON.stringify({ source: event.source, requestSchema: event.requestSchema, sensitiveFieldPaths: event.sensitiveFieldPaths });
    const prefs = await ctx.db.query("userPreferences").withIndex("by_user", q => q.eq("userId", context.run.userId)).first();
    const minutes = resolveQuestionTimeout(prefs?.localQuestionTimeoutMinutes);
    const automaticResponseAt = minutes && automaticQuestionContent(inputSchema) ? now + minutes * 60_000 : undefined;
    const requestId = await ctx.db.insert("runtimePermissionRequests", {
      userId: context.run.userId, chatId: context.job.chatId, generationJobId: context.job._id,
      runId: context.run._id, attemptId: context.attempt._id, fence: context.attempt.fence,
      primaryCommandRecordId: context.command._id, requestEventId: event.eventId, requestEventSequence: event.sequence,
      permissionRequestId: event.inputRequestId, nativeAgentThreadId: event.nativeAgentThreadId ?? undefined,
      permissionKind: "structured_input", prompt: event.prompt, choices: [],
      inputSchema, automaticResponseAt,
      status: "pending", createdAt: Date.now(), updatedAt: Date.now(),
    });
    await ctx.db.patch(context.run._id, { state: "waiting_for_input", updatedAt: now });
    if (automaticResponseAt !== undefined) await ctx.scheduler.runAt(automaticResponseAt, continueQuestionRef, { requestId, expectedResponseAt: automaticResponseAt });
    await notifyRuntimeRequest(ctx, context.run.userId, context.job.chatId);
    await notifyChannelInput(ctx, context.job.chatId, String(requestId));
    return;
  }
  const request = requests.find(request => request.inputSchema && ["pending", "responding"].includes(request.status));
  if (!request) throw new Error("RUNTIME_INPUT_REQUEST_MISSING");
  const command = request.responseCommandRecordId ? await ctx.db.get(request.responseCommandRecordId) : null;
  if (!command || context.command._id !== command._id || command.type !== "prompt" || command.expectedFence !== context.attempt.fence
    || command.attemptId !== context.attempt._id || command.claimedBy !== context.command.claimedBy
    || !["acknowledged", "completed"].includes(command.status) || request.inputOutcome !== event.outcome) throw new Error("RUNTIME_INPUT_COMMAND_MISMATCH");
  await ctx.db.patch(request._id, { status: "resolved", resolvedAt: Date.now(), updatedAt: Date.now() });
  const remaining = await ctx.db.query("runtimePermissionRequests").withIndex("by_attempt_status", q => q.eq("attemptId", context.attempt._id).eq("status", "pending")).first();
  const responding = await ctx.db.query("runtimePermissionRequests").withIndex("by_attempt_status", q => q.eq("attemptId", context.attempt._id).eq("status", "responding")).first();
  if (!remaining && !responding && context.run.state === "waiting_for_input") await ctx.db.patch(context.run._id, { state: "running", updatedAt: Date.now() });
}
export const respond = mutation({
  args: { requestId: v.id("runtimePermissionRequests"), outcome: v.union(v.literal("submitted"), v.literal("cancelled")), content: v.optional(v.string()) },
  returns: v.id("runtimeCommands"),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    return await respondToRuntimeInput(ctx, { ...args, userId });
  },
});
export async function respondToRuntimeInput(ctx: MutationCtx, args: { userId: string; requestId: Id<"runtimePermissionRequests">; outcome: "submitted" | "cancelled"; content?: string; responseSource?: "automatic"; now?: number }): Promise<Id<"runtimeCommands">> {
  const request = await ctx.db.get(args.requestId);
  if (!request?.inputSchema || request.userId !== args.userId) throw new ConvexError({ code: "NOT_FOUND", message: "Runtime input request not found" });
  const response = args.outcome === "cancelled" ? { outcome: "cancelled", content: null }
    : { outcome: "submitted", content: validateRuntimeInput(request.inputSchema, JSON.parse(args.content ?? "{}")) };
  const raw = JSON.stringify({ inputRequestId: request.permissionRequestId, response });
  const hash = await sha256Hex(raw);
  if (request.status === "responding" && request.inputResponseHash === hash && request.responseCommandRecordId) return request.responseCommandRecordId;
  if (request.status !== "pending") throw new ConvexError({ code: "CONFLICT", message: "This request already has a response or is no longer active" });
  const now = args.now ?? Date.now();
  const live = await inspectPermissionRuntime(ctx, request, now);
  if (!live.ready) throw new ConvexError({ code: "RUNTIME_UNAVAILABLE", message: "The requesting runtime is no longer available" });
  const commandId = `input-${String(request._id)}-${request.fence}`;
  const payload = await encryptSecret(raw, secretContext({ userId: args.userId, attemptId: request.attemptId, commandId }), mutationSafeNonce);
  const commandRecordId = await enqueueRuntimeHostCommand(ctx, {
    runId: request.runId, attemptId: request.attemptId, fence: request.fence, targetDeviceId: live.context.device.deviceId,
    commandId, type: "prompt", authorizationSource: args.responseSource === "automatic" ? "configured_automation" : "interactive_confirmation", initiatedBy: args.userId, payload, now,
  });
  await ctx.db.patch(request._id, { status: "responding", responseCommandRecordId: commandRecordId, inputOutcome: args.outcome, inputResponseHash: hash, responseSource: args.responseSource ?? "user", updatedAt: now });
  return commandRecordId;
}
