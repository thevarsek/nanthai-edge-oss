import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { requireAuth } from "../lib/auth";

const MAX_VISIBLE_NATIVE_AGENTS = 100;

const nativeAgentStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("interrupted"),
  v.literal("shutdown"),
  v.literal("not_found"),
);

const nativeAgentGroupStatus = v.union(
  v.literal("active"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("interrupted"),
);

const nativeAgentActivityKind = v.union(
  v.literal("delegation"),
  v.literal("message"),
  v.literal("reasoning"),
  v.literal("tool"),
  v.literal("interaction"),
);

const nativeAgentView = v.object({
  id: v.id("runtimeNativeAgents"),
  nativeThreadId: v.string(),
  parentNativeThreadId: v.optional(v.string()),
  depth: v.number(),
  agentPath: v.optional(v.string()),
  nickname: v.optional(v.string()),
  role: v.optional(v.string()),
  status: nativeAgentStatus,
  prompt: v.optional(v.string()),
  latestActivityKind: v.optional(nativeAgentActivityKind),
  latestActivity: v.optional(v.string()),
  statusSummary: v.optional(v.string()),
  output: v.optional(v.string()),
  error: v.optional(v.string()),
  actualModel: v.optional(v.object({
    provider: v.optional(v.string()),
    modelId: v.string(),
    reportedByAdapter: v.literal(true),
  })),
  reasoningEffort: v.optional(v.string()),
  startedAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
});

const nativeAgentGroupView = v.object({
  origin: v.literal("codex_native_agent"),
  group: v.object({
    id: v.id("runtimeNativeAgentGroups"),
    messageId: v.id("messages"),
    status: nativeAgentGroupStatus,
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  }),
  agents: v.array(nativeAgentView),
  agentsTruncated: v.boolean(),
});

type NativeAgentGroupView = {
  origin: "codex_native_agent";
  group: {
    id: Id<"runtimeNativeAgentGroups">;
    messageId: Id<"messages">;
    status: "active" | "completed" | "failed" | "cancelled" | "interrupted";
    startedAt: number;
    updatedAt: number;
    completedAt?: number;
  };
  agents: Array<{
    id: Id<"runtimeNativeAgents">;
    nativeThreadId: string;
    parentNativeThreadId?: string;
    depth: number;
    agentPath?: string;
    nickname?: string;
    role?: string;
    status: "pending" | "running" | "completed" | "failed" | "interrupted"
      | "shutdown" | "not_found";
    prompt?: string;
    latestActivityKind?: "delegation" | "message" | "reasoning" | "tool" | "interaction";
    latestActivity?: string;
    statusSummary?: string;
    output?: string;
    error?: string;
    actualModel?: { provider?: string; modelId: string; reportedByAdapter: true };
    reasoningEffort?: string;
    startedAt: number;
    updatedAt: number;
    completedAt?: number;
  }>;
  agentsTruncated: boolean;
};

export const getForMessage = query({
  args: { messageId: v.id("messages") },
  returns: v.union(nativeAgentGroupView, v.null()),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    return await getNativeAgentsForMessageHandler(ctx, { userId, ...args });
  },
});

export async function getNativeAgentsForMessageHandler(
  ctx: QueryCtx,
  args: { userId: string; messageId: Id<"messages"> },
): Promise<NativeAgentGroupView | null> {
  const message = await ctx.db.get(args.messageId);
  if (
    !message
    || message.userId !== args.userId
    || !message.runtimeNativeAgentGroupId
  ) return null;
  const [chat, group] = await Promise.all([
    ctx.db.get(message.chatId),
    ctx.db.get(message.runtimeNativeAgentGroupId),
  ]);
  if (
    !chat
    || chat.userId !== args.userId
    || chat.isDeleting === true
    || !group
    || group.userId !== args.userId
    || group.chatId !== chat._id
    || group.messageId !== message._id
  ) return null;
  const rows = await ctx.db.query("runtimeNativeAgents")
    .withIndex("by_group_ordinal", (index) => index.eq("groupId", group._id))
    .take(MAX_VISIBLE_NATIVE_AGENTS + 1);
  const agents = rows.slice(0, MAX_VISIBLE_NATIVE_AGENTS).map((agent) => ({
    id: agent._id,
    nativeThreadId: agent.nativeThreadId,
    parentNativeThreadId: agent.parentNativeThreadId,
    depth: agent.depth,
    agentPath: agent.agentPath,
    nickname: agent.nickname,
    role: agent.role,
    status: agent.status,
    prompt: agent.prompt,
    latestActivityKind: agent.latestActivityKind,
    latestActivity: agent.latestActivity,
    statusSummary: agent.statusSummary,
    output: agent.output,
    error: agent.error,
    actualModel: agent.actualModelId
      ? {
          provider: agent.actualModelProvider,
          modelId: agent.actualModelId,
          reportedByAdapter: true as const,
        }
      : undefined,
    reasoningEffort: agent.reasoningEffort,
    startedAt: agent.startedAt,
    updatedAt: agent.updatedAt,
    completedAt: agent.completedAt,
  }));
  return {
    origin: "codex_native_agent",
    group: {
      id: group._id,
      messageId: group.messageId,
      status: group.status,
      startedAt: group.startedAt,
      updatedAt: group.updatedAt,
      completedAt: group.completedAt,
    },
    agents,
    agentsTruncated: rows.length > MAX_VISIBLE_NATIVE_AGENTS,
  };
}
