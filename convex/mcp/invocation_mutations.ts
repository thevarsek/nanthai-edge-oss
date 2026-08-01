import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { assertCurrentFence } from "../execution/control_plane";
import { jsonForMcpStorage } from "./json_codec";
import { assertUserDataWritable, isUserDataWritable } from "../lib/write_fence";

const catalogKind = v.union(
  v.literal("tool"),
  v.literal("prompt"),
  v.literal("resource"),
  v.literal("resource_template"),
);

const invocationContentItem = v.object({
  kind: v.union(v.literal("text"), v.literal("image"), v.literal("audio"),
    v.literal("blob"), v.literal("resource_link")),
  role: v.optional(v.string()),
  text: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  mimeType: v.optional(v.string()),
  name: v.optional(v.string()),
  uri: v.optional(v.string()),
  sizeBytes: v.optional(v.number()),
});

export const createInvocation = internalMutation({
  args: {
    userId: v.string(),
    publicId: v.string(),
    connectionId: v.id("mcpConnections"),
    catalogItemId: v.id("mcpCatalogItems"),
    catalogStableKey: v.string(),
    itemName: v.string(),
    toolAlias: v.optional(v.string()),
    kind: catalogKind,
    method: v.string(),
    requestHash: v.string(),
    requestParams: v.optional(v.any()),
    chatId: v.optional(v.id("chats")),
    messageId: v.optional(v.id("messages")),
    generationJobId: v.optional(v.id("generationJobs")),
    attemptId: v.optional(v.id("executionAttempts")),
    fence: v.optional(v.number()),
    operationKey: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertUserDataWritable(ctx, args.userId, args.chatId);
    if ((args.attemptId === undefined) !== (args.fence === undefined)) {
      throw new Error("MCP_EXECUTION_IDENTITY_INCOMPLETE");
    }
    const execution = args.attemptId && args.fence !== undefined
      ? await assertCurrentFence(ctx, args.attemptId, args.fence)
      : null;
    if (execution && execution.run.userId !== args.userId) {
      throw new Error("MCP_EXECUTION_OWNER_MISMATCH");
    }
    const now = Date.now();
    return await ctx.db.insert("mcpInvocations", {
      ...args,
      requestParams: jsonForMcpStorage(args.requestParams),
      runId: execution?.run._id,
      state: "dispatching",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const finishInvocation = internalMutation({
  args: {
    invocationId: v.id("mcpInvocations"),
    state: v.union(
      v.literal("awaiting_input"),
      v.literal("task_pending"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
      v.literal("outcome_unknown"),
    ),
    requestState: v.optional(v.any()),
    inputRequests: v.optional(v.any()),
    taskId: v.optional(v.string()),
    taskStatus: v.optional(v.string()),
    result: v.optional(v.any()),
    contextText: v.optional(v.string()),
    contentItems: v.optional(v.array(invocationContentItem)),
    errorCode: v.optional(v.string()),
    expectedOperationKey: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { invocationId, expectedOperationKey, ...values } = args;
    const invocation = await ctx.db.get(invocationId);
    if (
      !invocation
      || ["completed", "failed", "cancelled", "outcome_unknown"].includes(invocation.state)
      || (expectedOperationKey !== undefined
        && invocation.activeOperationKey !== expectedOperationKey)
    ) {
      return false;
    }
    const terminal = values.state === "completed"
      || values.state === "failed"
      || values.state === "cancelled"
      || values.state === "outcome_unknown";
    await ctx.db.patch(invocationId, {
      ...values,
      requestState: jsonForMcpStorage(values.requestState),
      inputRequests: jsonForMcpStorage(values.inputRequests),
      result: jsonForMcpStorage(values.result),
      activeOperationKey: undefined,
      updatedAt: Date.now(),
      completedAt: terminal ? Date.now() : undefined,
    });
    return true;
  },
});

export const claimInvocationOperation = internalMutation({
  args: {
    invocationId: v.id("mcpInvocations"),
    operationKey: v.string(),
    mode: v.union(v.literal("continuation"), v.literal("task_get"),
      v.literal("task_update"), v.literal("task_cancel")),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const invocation = await ctx.db.get(args.invocationId);
    if (!invocation || invocation.state === "dispatching") return false;
    const terminal = ["completed", "failed", "cancelled", "outcome_unknown"].includes(
      invocation.state,
    );
    const isTask = Boolean(invocation.taskId);
    const eligible = args.mode === "continuation"
      ? invocation.state === "awaiting_input" && !isTask
      : isTask && (
          args.mode === "task_update"
            ? invocation.state === "awaiting_input"
            : invocation.state === "awaiting_input" || invocation.state === "task_pending"
        );
    if (terminal || !eligible) return false;
    await ctx.db.patch(invocation._id, {
      state: "dispatching",
      activeOperationKey: args.operationKey,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const releaseInvocationOperation = internalMutation({
  args: {
    invocationId: v.id("mcpInvocations"),
    operationKey: v.string(),
    state: v.union(v.literal("awaiting_input"), v.literal("task_pending")),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const invocation = await ctx.db.get(args.invocationId);
    if (
      !invocation
      || invocation.state !== "dispatching"
      || invocation.activeOperationKey !== args.operationKey
    ) {
      return false;
    }
    await ctx.db.patch(invocation._id, {
      state: args.state,
      activeOperationKey: undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const failPendingInvocation = internalMutation({
  args: {
    invocationId: v.id("mcpInvocations"),
    errorCode: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invocation = await ctx.db.get(args.invocationId);
    if (!invocation || ["completed", "failed", "cancelled", "outcome_unknown"].includes(
      invocation.state,
    )) return null;
    await ctx.db.patch(invocation._id, {
      state: "failed",
      errorCode: args.errorCode,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const attachArtifacts = internalMutation({
  args: {
    publicId: v.string(),
    userId: v.string(),
    chatId: v.id("chats"),
    jobId: v.id("generationJobs"),
    artifactIds: v.array(v.id("toolExecutionArtifacts")),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invocation = await ctx.db
      .query("mcpInvocations")
      .withIndex("by_user_public_id", (q) =>
        q.eq("userId", args.userId).eq("publicId", args.publicId),
      )
      .unique();
    if (
      !invocation
      || invocation.chatId !== args.chatId
      || invocation.generationJobId !== args.jobId
      || !await isUserDataWritable(ctx, args.userId, args.chatId)
    ) return null;
    if ((args.executionAttemptId === undefined) !== (args.executionFence === undefined)) {
      return null;
    }
    if (args.executionAttemptId && args.executionFence !== undefined) {
      const execution = await assertCurrentFence(
        ctx,
        args.executionAttemptId,
        args.executionFence,
      );
      if (execution.run.userId !== args.userId || execution.run.chatId !== args.chatId) return null;
    }
    const ownedArtifactIds = [];
    for (const artifactId of args.artifactIds.slice(0, 100)) {
      const artifact = await ctx.db.get(artifactId);
      if (
        artifact?.userId === args.userId
        && artifact.chatId === args.chatId
        && artifact.jobId === args.jobId
      ) ownedArtifactIds.push(String(artifactId));
    }
    await ctx.db.patch(invocation._id, {
      artifactIds: [...new Set([...(invocation.artifactIds ?? []), ...ownedArtifactIds])],
      updatedAt: Date.now(),
    });
    return null;
  },
});
