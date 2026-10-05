import { runtimeInputForm, projectRuntimeInputForm, type RuntimeInputForm } from "./input_form";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { enqueueRuntimeHostCommand } from "./command_transport";
import { inspectPermissionRuntime } from "./permission_live_context";
import {
  runtimePermissionDecision,
  runtimePermissionUnavailableReason,
  type RuntimePermissionDecision,
} from "./permission_validators";
import {
  projectPermissionNativeAgent,
  type PermissionNativeAgentIdentity,
} from "./permission_native_agent";

const activePermissionStatus = v.union(
  v.literal("pending"),
  v.literal("responding"),
);

const pendingPermission = v.object({
  requestId: v.id("runtimePermissionRequests"),
  chatId: v.id("chats"),
  messageId: v.id("messages"),
  generationJobId: v.optional(v.id("generationJobs")),
  runId: v.id("executionRuns"),
  attemptId: v.id("executionAttempts"),
  chatParticipantId: v.optional(v.id("chatParticipants")),
  permissionRequestId: v.string(),
  nativeAgentThreadId: v.optional(v.string()),
  nativeAgent: v.optional(v.object({
    origin: v.literal("codex_native_agent"),
    nativeThreadId: v.string(),
    label: v.string(),
    nickname: v.optional(v.string()),
    role: v.optional(v.string()),
  })),
  toolCallId: v.optional(v.string()),
  permissionKind: v.string(),
  prompt: v.string(),
  inputForm: v.optional(runtimeInputForm),
  choices: v.array(runtimePermissionDecision),
  status: activePermissionStatus,
  requestedDecision: v.optional(runtimePermissionDecision),
  expiresAt: v.optional(v.number()),
  automaticResponseAt: v.optional(v.number()),
  responseSource: v.optional(v.union(v.literal("user"), v.literal("automatic"))),
  createdAt: v.number(),
  canRespond: v.boolean(),
  unavailableReason: v.optional(runtimePermissionUnavailableReason),
});

type PendingPermission = {
  requestId: Id<"runtimePermissionRequests">;
  chatId: Id<"chats">;
  messageId: Id<"messages">;
  generationJobId?: Id<"generationJobs">;
  runId: Id<"executionRuns">;
  attemptId: Id<"executionAttempts">;
  chatParticipantId?: Id<"chatParticipants">;
  permissionRequestId: string;
  nativeAgentThreadId?: string;
  nativeAgent?: PermissionNativeAgentIdentity;
  toolCallId?: string;
  permissionKind: string;
  prompt: string;
  inputForm?: RuntimeInputForm;
  choices: RuntimePermissionDecision[];
  status: "pending" | "responding";
  requestedDecision?: RuntimePermissionDecision;
  expiresAt?: number;
  automaticResponseAt?: number;
  responseSource?: "user" | "automatic";
  createdAt: number;
  canRespond: boolean;
  unavailableReason?: "response_pending" | "request_expired"
    | "execution_unavailable" | "runtime_host_offline"
    | "runtime_adapter_unavailable" | "runtime_session_unavailable";
};

export const listMyPending = query({
  args: { chatId: v.id("chats") },
  returns: v.array(pendingPermission),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    return await listMyPendingPermissionsHandler(ctx, { userId, ...args });
  },
});

export async function listMyPendingPermissionsHandler(
  ctx: QueryCtx,
  args: { userId: string; chatId: Id<"chats">; now?: number },
): Promise<PendingPermission[]> {
  const chat = await ctx.db.get(args.chatId);
  if (!chat || chat.userId !== args.userId || chat.isDeleting === true) return [];
  const grouped = await Promise.all((["pending", "responding"] as const).map((status) =>
    ctx.db.query("runtimePermissionRequests")
      .withIndex("by_user_chat_status", (index) =>
        index.eq("userId", args.userId).eq("chatId", chat._id).eq("status", status)
      )
      .collect()
  ));
  const requests = grouped.flat().sort((left, right) => left.createdAt - right.createdAt);
  const projected = await Promise.all(requests.map(async (request) =>
    await projectPendingPermission(ctx, request, args.now ?? Date.now())
  ));
  return projected.filter((item): item is PendingPermission => item !== null);
}

export const respond = mutation({
  args: {
    requestId: v.id("runtimePermissionRequests"),
    decision: runtimePermissionDecision,
  },
  returns: v.object({
    requestId: v.id("runtimePermissionRequests"),
    status: v.literal("responding"),
    commandRecordId: v.id("runtimeCommands"),
  }),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    return await respondToPermissionHandler(ctx, { userId, ...args });
  },
});

export async function respondToPermissionHandler(
  ctx: MutationCtx,
  args: {
    userId: string;
    requestId: Id<"runtimePermissionRequests">;
    decision: RuntimePermissionDecision;
    now?: number;
  },
): Promise<{
  requestId: Id<"runtimePermissionRequests">;
  status: "responding";
  commandRecordId: Id<"runtimeCommands">;
}> {
  const request = await ctx.db.get(args.requestId);
  if (!request || request.userId !== args.userId) {
    throw permissionError("NOT_FOUND", "Runtime permission request not found");
  }
  if (request.inputSchema) throw permissionError("VALIDATION_ERROR", "Use the input response form for this request");
  if (!request.choices.includes(args.decision)) {
    throw permissionError(
      "RUNTIME_PERMISSION_CHOICE_UNAVAILABLE",
      "This Runtime Host did not offer the selected permission decision",
    );
  }
  if (request.status === "responding") {
    if (
      request.requestedDecision !== args.decision
      || !request.responseCommandRecordId
    ) {
      throw permissionError(
        "CONFLICT",
        "A different permission decision is already being delivered",
      );
    }
    return {
      requestId: request._id,
      status: "responding",
      commandRecordId: request.responseCommandRecordId,
    };
  }
  if (request.status !== "pending") {
    throw permissionError(
      request.status === "expired" ? "RUNTIME_PERMISSION_EXPIRED" : "CONFLICT",
      request.status === "expired"
        ? "Runtime permission request has expired"
        : "Runtime permission request is no longer awaiting a response",
    );
  }
  const now = args.now ?? Date.now();
  const availability = await inspectPermissionRuntime(ctx, request, now);
  if (!availability.ready) throw availabilityError(availability.reason);
  const { run, attempt, device } = availability.context;
  const commandId = `permission-${String(request._id)}-${attempt.fence}`;
  const commandRecordId = await enqueueRuntimeHostCommand(ctx, {
    runId: run._id,
    attemptId: attempt._id,
    fence: attempt.fence,
    targetDeviceId: device.deviceId,
    commandId,
    type: "permission_response",
    authorizationSource: "interactive_confirmation",
    initiatedBy: args.userId,
    payload: JSON.stringify({
      permissionRequestId: request.permissionRequestId,
      decision: args.decision,
    }),
    ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
    now,
  });
  await ctx.db.patch(request._id, {
    status: "responding",
    requestedDecision: args.decision,
    responseCommandRecordId: commandRecordId,
    updatedAt: now,
  });
  return { requestId: request._id, status: "responding", commandRecordId };
}

async function projectPendingPermission(
  ctx: QueryCtx,
  request: Doc<"runtimePermissionRequests">,
  now: number,
): Promise<PendingPermission | null> {
  if (request.status !== "pending" && request.status !== "responding") return null;
  const [run, job, attempt] = await Promise.all([
    ctx.db.get(request.runId),
    request.generationJobId ? ctx.db.get(request.generationJobId) : null,
    ctx.db.get(request.attemptId),
  ]);
  if (
    !run
    || (!job && !run.sourceMessageId)
    || !attempt
    || run.chatId !== request.chatId
    || run.state === "cancelling"
    || run.state === "completed"
    || run.state === "failed"
    || run.state === "cancelled"
  ) return null;
  const availability = request.status === "responding"
    ? { ready: false as const, reason: "response_pending" as const }
    : await inspectPermissionRuntime(ctx, request, now);
  const nativeAgent = await projectPermissionNativeAgent(ctx, request);
  return {
    requestId: request._id,
    chatId: request.chatId,
    messageId: (job?.messageId ?? run.sourceMessageId) as Id<"messages">,
    ...(job ? { generationJobId: job._id } : {}),
    runId: run._id,
    attemptId: attempt._id,
    ...(attempt.chatParticipantId === undefined
      ? {}
      : { chatParticipantId: attempt.chatParticipantId }),
    permissionRequestId: request.permissionRequestId,
    ...(request.nativeAgentThreadId === undefined
      ? {}
      : { nativeAgentThreadId: request.nativeAgentThreadId }),
    ...(nativeAgent === undefined ? {} : { nativeAgent }),
    ...(request.toolCallId === undefined ? {} : { toolCallId: request.toolCallId }),
    permissionKind: request.permissionKind,
    prompt: request.prompt,
    ...(request.inputSchema ? { inputForm: projectRuntimeInputForm(request.inputSchema) } : {}),
    choices: request.choices,
    status: request.status,
    ...(request.requestedDecision === undefined
      ? {}
      : { requestedDecision: request.requestedDecision }),
    ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
    ...(request.automaticResponseAt === undefined ? {} : { automaticResponseAt: request.automaticResponseAt }),
    ...(request.responseSource === undefined ? {} : { responseSource: request.responseSource }),
    createdAt: request.createdAt,
    canRespond: availability.ready,
    ...(availability.ready ? {} : { unavailableReason: availability.reason }),
  };
}

function availabilityError(reason: string): ConvexError<{
  code: string;
  message: string;
}> {
  if (reason === "request_expired") {
    return permissionError("RUNTIME_PERMISSION_EXPIRED", "Runtime permission request has expired");
  }
  if (reason === "runtime_adapter_unavailable") {
    return permissionError(
      "RUNTIME_PERMISSION_UNSUPPORTED",
      "The active Runtime Host adapter cannot answer permission requests",
    );
  }
  if (reason === "runtime_host_offline") {
    return permissionError("RUNTIME_UNAVAILABLE", "The active Runtime Host is offline");
  }
  if (reason === "runtime_session_unavailable") {
    return permissionError(
      "RUNTIME_SESSION_UNAVAILABLE",
      "The Runtime Host session that requested permission is no longer active",
    );
  }
  return permissionError(
    "STALE_EXECUTION_FENCE",
    "Runtime permission request no longer belongs to the active execution",
  );
}

function permissionError(code: string, message: string): ConvexError<{
  code: string;
  message: string;
}> {
  return new ConvexError({ code, message });
}
