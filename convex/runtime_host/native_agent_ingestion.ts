import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { NonTerminalAdapterEvent } from "./protocol_adapter_events";
import type { RuntimeChatEventContext } from "./chat_terminal_ingestion";
import { RUNTIME_LIMITS } from "./protocol_common";

type NativeAgentEvent = Extract<
  NonTerminalAdapterEvent,
  { type: "native_agent_started" | "native_agent_activity" | "native_agent_status" }
>;
type NativeAgentStartedEvent = Extract<NativeAgentEvent, { type: "native_agent_started" }>;
type NativeAgentActivityEvent = Extract<NativeAgentEvent, { type: "native_agent_activity" }>;
type NativeAgentStatusEvent = Extract<NativeAgentEvent, { type: "native_agent_status" }>;
type AgentStatus = Doc<"runtimeNativeAgents">["status"];

export async function applyRuntimeNativeAgentEvent(
  ctx: MutationCtx,
  context: RuntimeChatEventContext,
  event: NativeAgentEvent,
): Promise<void> {
  if (event.type === "native_agent_started") {
    await applyAgentStarted(ctx, context, event);
  } else if (event.type === "native_agent_activity") {
    await applyAgentActivity(ctx, context, event);
  } else {
    await applyAgentStatus(ctx, context, event);
  }
}

async function applyAgentStarted(
  ctx: MutationCtx,
  context: RuntimeChatEventContext,
  event: NativeAgentStartedEvent,
): Promise<void> {
  const group = await loadOrCreateGroup(ctx, context, event);
  const existing = await findAgent(ctx, group._id, event.nativeThreadId);
  if (existing) {
    if (
      existing.parentNativeThreadId !== (event.parentNativeThreadId ?? undefined)
      || existing.depth !== event.depth
    ) throw new Error("RUNTIME_NATIVE_AGENT_LINEAGE_CONFLICT");
    await ctx.db.patch(existing._id, {
      agentPath: event.agentPath ?? existing.agentPath,
      nickname: event.nickname ?? existing.nickname,
      role: event.role ?? existing.role,
      prompt: event.prompt ?? existing.prompt,
      actualModelProvider: event.actualModel === null
        ? existing.actualModelProvider
        : event.actualModel.provider ?? undefined,
      actualModelId: event.actualModel?.modelId ?? existing.actualModelId,
      reasoningEffort: event.reasoningEffort ?? existing.reasoningEffort,
      status: isTerminalAgentStatus(existing.status) ? existing.status : "running",
      updatedAt: event.occurredAt,
    });
  } else {
    await ctx.db.insert("runtimeNativeAgents", {
      groupId: group._id,
      userId: group.userId,
      chatId: group.chatId,
      messageId: group.messageId,
      nativeThreadId: event.nativeThreadId,
      parentNativeThreadId: event.parentNativeThreadId ?? undefined,
      ordinal: group.nextAgentOrdinal,
      depth: event.depth,
      agentPath: event.agentPath ?? undefined,
      nickname: event.nickname ?? undefined,
      role: event.role ?? undefined,
      prompt: event.prompt ?? undefined,
      actualModelProvider: event.actualModel?.provider ?? undefined,
      actualModelId: event.actualModel?.modelId,
      reasoningEffort: event.reasoningEffort ?? undefined,
      status: "running",
      startedAt: event.occurredAt,
      updatedAt: event.occurredAt,
    });
    await ctx.db.patch(group._id, {
      nextAgentOrdinal: group.nextAgentOrdinal + 1,
      updatedAt: event.occurredAt,
    });
  }
}

async function applyAgentActivity(
  ctx: MutationCtx,
  context: RuntimeChatEventContext,
  event: NativeAgentActivityEvent,
): Promise<void> {
  const { group, agent } = await loadExistingAgent(ctx, context, event.nativeThreadId);
  const continuesActivity = agent.latestActivityId === event.activityId
    && agent.latestActivityKind === event.kind;
  const latestActivity = continuesActivity
    ? appendBounded(agent.latestActivity, event.summary)
    : truncateUnicodeSafe(event.summary, RUNTIME_LIMITS.detailCharacters);
  const output = event.kind === "message"
    ? continuesActivity
      ? appendBounded(agent.output, event.summary)
      : truncateUnicodeSafe(event.summary, RUNTIME_LIMITS.detailCharacters)
    : agent.output;
  await ctx.db.patch(agent._id, {
    latestActivityId: event.activityId,
    latestActivityKind: event.kind,
    latestActivity,
    output,
    updatedAt: event.occurredAt,
  });
  await ctx.db.patch(group._id, { updatedAt: event.occurredAt });
}

async function applyAgentStatus(
  ctx: MutationCtx,
  context: RuntimeChatEventContext,
  event: NativeAgentStatusEvent,
): Promise<void> {
  const { group, agent } = await loadExistingAgent(ctx, context, event.nativeThreadId);
  const terminal = isTerminalAgentStatus(event.status);
  await ctx.db.patch(agent._id, {
    status: event.status,
    statusSummary: event.summary ?? agent.statusSummary,
    error: event.status === "failed" || event.status === "not_found"
      ? event.summary ?? agent.error
      : agent.error,
    actualModelProvider: event.actualModel === null
      ? agent.actualModelProvider
      : event.actualModel.provider ?? undefined,
    actualModelId: event.actualModel?.modelId ?? agent.actualModelId,
    reasoningEffort: event.reasoningEffort ?? agent.reasoningEffort,
    completedAt: terminal ? event.occurredAt : undefined,
    updatedAt: event.occurredAt,
  });
  await ctx.db.patch(group._id, { updatedAt: event.occurredAt });
}

async function loadOrCreateGroup(
  ctx: MutationCtx,
  context: RuntimeChatEventContext,
  event: NativeAgentStartedEvent,
): Promise<Doc<"runtimeNativeAgentGroups">> {
  const existing = await groupForAttempt(ctx, context.attempt._id);
  if (existing) {
    assertGroupIdentity(existing, context, event.sessionId, event.rootNativeThreadId);
    return existing;
  }
  const chatId = context.run.chatId;
  if (!chatId || chatId !== context.job.chatId) {
    throw new Error("RUNTIME_NATIVE_AGENT_CHAT_REQUIRED");
  }
  const message = await ctx.db.get(context.job.messageId);
  if (!message || message.userId !== context.run.userId || message.chatId !== chatId) {
    throw new Error("RUNTIME_NATIVE_AGENT_MESSAGE_REQUIRED");
  }
  const groupId = await ctx.db.insert("runtimeNativeAgentGroups", {
    userId: context.run.userId,
    chatId,
    messageId: message._id,
    generationJobId: context.job._id,
    runId: context.run._id,
    attemptId: context.attempt._id,
    fence: context.attempt.fence,
    adapterId: context.attempt.adapterId,
    rootNativeSessionId: event.sessionId,
    rootNativeThreadId: event.rootNativeThreadId,
    status: "active",
    nextAgentOrdinal: 0,
    startedAt: event.occurredAt,
    updatedAt: event.occurredAt,
  });
  await ctx.db.patch(message._id, { runtimeNativeAgentGroupId: groupId });
  const group = await ctx.db.get(groupId);
  if (!group) throw new Error("RUNTIME_NATIVE_AGENT_GROUP_INSERT_FAILED");
  return group;
}

async function loadExistingAgent(
  ctx: MutationCtx,
  context: RuntimeChatEventContext,
  nativeThreadId: string,
): Promise<{ group: Doc<"runtimeNativeAgentGroups">; agent: Doc<"runtimeNativeAgents"> }> {
  const group = await groupForAttempt(ctx, context.attempt._id);
  if (!group || group.runId !== context.run._id || group.fence !== context.attempt.fence) {
    throw new Error("RUNTIME_NATIVE_AGENT_START_REQUIRED");
  }
  const agent = await findAgent(ctx, group._id, nativeThreadId);
  if (!agent) throw new Error("RUNTIME_NATIVE_AGENT_START_REQUIRED");
  return { group, agent };
}

async function groupForAttempt(
  ctx: MutationCtx,
  attemptId: Id<"executionAttempts">,
): Promise<Doc<"runtimeNativeAgentGroups"> | null> {
  return await ctx.db.query("runtimeNativeAgentGroups")
    .withIndex("by_attempt", (index) => index.eq("attemptId", attemptId))
    .unique();
}

async function findAgent(
  ctx: MutationCtx,
  groupId: Id<"runtimeNativeAgentGroups">,
  nativeThreadId: string,
): Promise<Doc<"runtimeNativeAgents"> | null> {
  return await ctx.db.query("runtimeNativeAgents")
    .withIndex("by_group_thread", (index) =>
      index.eq("groupId", groupId).eq("nativeThreadId", nativeThreadId)
    )
    .unique();
}

function assertGroupIdentity(
  group: Doc<"runtimeNativeAgentGroups">,
  context: RuntimeChatEventContext,
  rootNativeSessionId: string,
  rootNativeThreadId: string,
): void {
  if (
    group.runId !== context.run._id
    || group.generationJobId !== context.job._id
    || group.messageId !== context.job.messageId
    || group.fence !== context.attempt.fence
    || group.adapterId !== context.attempt.adapterId
    || group.rootNativeSessionId !== rootNativeSessionId
    || group.rootNativeThreadId !== rootNativeThreadId
  ) throw new Error("RUNTIME_NATIVE_AGENT_GROUP_CONFLICT");
}

function isTerminalAgentStatus(status: AgentStatus): boolean {
  return status === "completed" || status === "failed" || status === "interrupted"
    || status === "shutdown" || status === "not_found";
}

function appendBounded(existing: string | undefined, chunk: string): string {
  return truncateUnicodeSafe(
    `${existing ?? ""}${chunk}`,
    RUNTIME_LIMITS.detailCharacters,
  );
}

function truncateUnicodeSafe(value: string, maximumCodeUnits: number): string {
  let codeUnits = 0;
  let result = "";
  for (const character of value) {
    if (codeUnits + character.length > maximumCodeUnits) break;
    result += character;
    codeUnits += character.length;
  }
  return result;
}
