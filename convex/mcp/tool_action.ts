"use node";

import { createHash, randomUUID } from "node:crypto";
import { ConvexError, v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { loadMcpCredential } from "./credentials";
import { mcpJsonFromStorage } from "./json_codec";
import { openMcpClient } from "./sdk_client";
import { MCP_MAX_RESULT_BYTES } from "./policy";
import { mcpCatalogItemDisplayName } from "./display";

export const invokeAllowedTool = internalAction({
  args: {
    userId: v.string(),
    connectionPublicId: v.string(),
    stableKey: v.string(),
    arguments: v.any(),
    chatId: v.optional(v.id("chats")),
    messageId: v.optional(v.id("messages")),
    generationJobId: v.optional(v.id("generationJobs")),
    attemptId: v.optional(v.id("executionAttempts")),
    fence: v.optional(v.number()),
    operationKey: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.mcp.queries.assertPro, { userId: args.userId });
    const connection = await ctx.runQuery(internal.mcp.queries.getOwnedConnection, {
      userId: args.userId,
      publicId: args.connectionPublicId,
    });
    if (!connection || connection.status !== "active") {
      throw new ConvexError({ code: "MCP_DISABLED", message: "Remote MCP server is disabled." });
    }
    const item = await ctx.runQuery(internal.mcp.queries.getAllowedItem, {
      userId: args.userId,
      connectionId: connection._id,
      stableKey: args.stableKey,
    });
    if (!item || item.kind !== "tool") {
      throw new ConvexError({ code: "MCP_ITEM_DISABLED", message: "Remote MCP tool is disabled." });
    }
    const requestParams = { name: item.remoteName, arguments: args.arguments };
    const publicId = randomUUID();
    const invocationId = await ctx.runMutation(internal.mcp.invocation_mutations.createInvocation, {
      userId: args.userId,
      publicId,
      connectionId: connection._id,
      catalogItemId: item._id,
      catalogStableKey: item.stableKey,
      itemName: mcpCatalogItemDisplayName(item),
      toolAlias: item.toolAlias,
      kind: "tool",
      method: "tools/call",
      requestHash: createHash("sha256").update(JSON.stringify(requestParams)).digest("hex"),
      requestParams,
      chatId: args.chatId,
      messageId: args.messageId,
      generationJobId: args.generationJobId,
      attemptId: args.attemptId,
      fence: args.fence,
      operationKey: args.operationKey,
      toolCallId: args.toolCallId,
    });
    let opened: Awaited<ReturnType<typeof openMcpClient>> | undefined;
    try {
      const credential = await loadMcpCredential(ctx, args.userId, connection._id);
      opened = await openMcpClient({
        endpoint: connection.endpoint,
        cachePartition: `${args.userId}:${connection.publicId}`,
        credential,
      });
      const result = await opened.client.callTool(requestParams, {
        timeout: 55_000,
        maxTotalTimeout: 55_000,
        allowInputRequired: true,
        toolDefinition: {
          name: item.remoteName,
          description: item.description,
          inputSchema: mcpJsonFromStorage(item.inputSchema) as never,
        },
      });
      if (JSON.stringify(result).length > MCP_MAX_RESULT_BYTES) throw new Error("MCP_RESULT_TOO_LARGE");
      const record = result as unknown as Record<string, unknown>;
      if (record.resultType === "input_required") {
        const persisted = await ctx.runMutation(internal.mcp.invocation_mutations.finishInvocation, {
          invocationId,
          state: "awaiting_input",
          requestState: record.requestState,
          inputRequests: record.inputRequests,
        });
        if (!persisted) throw new Error("MCP_INVOCATION_SUPERSEDED");
        return { success: false, state: "awaiting_input", invocationId: publicId };
      }
      if (record.resultType === "task") {
        const persisted = await ctx.runMutation(internal.mcp.invocation_mutations.finishInvocation, {
          invocationId,
          state: "task_pending",
          taskId: typeof record.taskId === "string" ? record.taskId : undefined,
          taskStatus: typeof record.status === "string" ? record.status : "working",
          result,
        });
        if (!persisted) throw new Error("MCP_INVOCATION_SUPERSEDED");
        return { success: true, state: "task_pending", invocationId: publicId, result };
      }
      const persisted = await ctx.runMutation(internal.mcp.invocation_mutations.finishInvocation, {
        invocationId,
        state: "completed",
        result,
      });
      if (!persisted) throw new Error("MCP_INVOCATION_SUPERSEDED");
      return { success: true, state: "completed", invocationId: publicId, result };
    } catch {
      await ctx.runMutation(internal.mcp.invocation_mutations.finishInvocation, {
        invocationId,
        state: "outcome_unknown",
        errorCode: "MCP_OUTCOME_UNKNOWN",
      });
      throw new ConvexError({ code: "MCP_INVOCATION_FAILED", message: "The Remote MCP tool failed safely." });
    } finally {
      if (opened) await opened.close();
    }
  },
});
