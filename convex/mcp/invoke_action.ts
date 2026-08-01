"use node";

import { randomUUID } from "node:crypto";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import { hashJson } from "./catalog";
import { loadMcpCredential } from "./credentials";
import { mcpJsonFromStorage } from "./json_codec";
import { openMcpClient } from "./sdk_client";
import {
  deleteMcpInvocationContent,
  mapMcpInvocationContent,
  type McpInvocationContentItem,
} from "./content_mapping";
import { mcpCatalogItemDisplayName, mcpConnectionDisplayName } from "./display";
import { invocationMethod } from "./action_contract";
import {
  isMcpAuthenticationError,
  serializeBoundedMcpResult,
} from "./policy";
import { resolveAllowedResourceUri } from "./resource_policy";

type InvokeMcpArgs = {
  connectionId: string;
  stableKey: string;
  kind: "tool" | "prompt" | "resource" | "resource_template";
  arguments?: unknown;
  uri?: string;
  requestState?: unknown;
  inputResponses?: unknown;
  chatId?: Id<"chats">;
};

export async function invokeMcp(
  ctx: ActionCtx,
  args: InvokeMcpArgs,
): Promise<unknown> {
  const { userId } = await requireAuth(ctx);
  await ctx.runQuery(internal.mcp.queries.assertPro, { userId });
  if (args.chatId) {
    await ctx.runQuery(internal.mcp.queries.assertOwnedChat, { userId, chatId: args.chatId });
  }
  const connection = await ctx.runQuery(internal.mcp.queries.getOwnedConnection, {
    userId,
    publicId: args.connectionId,
  });
  if (!connection || connection.status !== "active") {
    throw new ConvexError({ code: "MCP_DISABLED", message: "This Remote MCP server is not enabled." });
  }
  const item = await ctx.runQuery(internal.mcp.queries.getAllowedItem, {
    userId,
    connectionId: connection._id,
    stableKey: args.stableKey,
  });
  if (!item || item.kind !== args.kind) {
    throw new ConvexError({ code: "MCP_ITEM_DISABLED", message: "This Remote MCP item is disabled." });
  }
  let resourceUri: string | undefined;
  if (args.kind === "resource" || args.kind === "resource_template") {
    resourceUri = resolveAllowedResourceUri(args.kind, item, args.uri, args.arguments);
  }
  const requestParams = args.kind === "tool"
    ? { name: item.remoteName, arguments: args.arguments ?? {}, requestState: args.requestState, inputResponses: args.inputResponses }
    : args.kind === "prompt"
      ? { name: item.remoteName, arguments: args.arguments ?? {}, requestState: args.requestState, inputResponses: args.inputResponses }
      : { uri: resourceUri, requestState: args.requestState, inputResponses: args.inputResponses };
  const publicId = randomUUID();
  const invocationId = await ctx.runMutation(internal.mcp.invocation_mutations.createInvocation, {
    userId,
    publicId,
    connectionId: connection._id,
    catalogItemId: item._id,
    catalogStableKey: item.stableKey,
    itemName: mcpCatalogItemDisplayName(item),
    toolAlias: item.toolAlias,
    kind: args.kind,
    method: invocationMethod(args.kind),
    requestHash: hashJson(requestParams),
    requestParams,
    chatId: args.chatId,
  });
  let opened: Awaited<ReturnType<typeof openMcpClient>> | undefined;
  let mappedContentItems: McpInvocationContentItem[] | undefined;
  let contentPersisted = false;
  let remoteToolDispatched = false;
  try {
    const credential = await loadMcpCredential(ctx, userId, connection._id);
    opened = await openMcpClient({
      endpoint: connection.endpoint,
      cachePartition: `${userId}:${connection.publicId}`,
      credential,
    });
    let result: unknown;
    if (args.kind === "tool") {
      remoteToolDispatched = true;
      result = await opened.client.callTool(requestParams as never, {
        timeout: 55_000,
        maxTotalTimeout: 55_000,
        allowInputRequired: true,
        toolDefinition: {
          name: item.remoteName,
          description: item.description,
          inputSchema: mcpJsonFromStorage(item.inputSchema),
          outputSchema: mcpJsonFromStorage(item.outputSchema),
          annotations: mcpJsonFromStorage(item.annotations),
        } as never,
      });
    } else if (args.kind === "prompt") {
      result = await opened.client.getPrompt(requestParams as never, {
        timeout: 55_000,
        maxTotalTimeout: 55_000,
        allowInputRequired: true,
      });
    } else {
      if (!requestParams.uri) {
        throw new ConvexError({ code: "MCP_URI_REQUIRED", message: "Enter a resource URI." });
      }
      result = await opened.client.readResource(requestParams as never, {
        timeout: 55_000,
        maxTotalTimeout: 55_000,
        allowInputRequired: true,
        cacheMode: "refresh",
      });
    }
    serializeBoundedMcpResult(result);
    const record = result as Record<string, unknown>;
    const resultType = record.resultType;
    if (resultType === "input_required") {
      const persisted = await ctx.runMutation(internal.mcp.invocation_mutations.finishInvocation, {
        invocationId,
        state: "awaiting_input",
        requestState: record.requestState,
        inputRequests: record.inputRequests,
      });
      if (!persisted) throw new Error("MCP_INVOCATION_SUPERSEDED");
      await ctx.runMutation(internal.mcp.lifecycle_mutations.startStandaloneInvocation, {
        userId,
        publicId,
      });
      return {
        invocationId: publicId,
        state: "awaiting_input",
        inputRequests: record.inputRequests,
        requestState: record.requestState,
      };
    }
    if (resultType === "task") {
      const persisted = await ctx.runMutation(internal.mcp.invocation_mutations.finishInvocation, {
        invocationId,
        state: "task_pending",
        taskId: typeof record.taskId === "string" ? record.taskId : undefined,
        taskStatus: typeof record.status === "string" ? record.status : "working",
        result,
      });
      if (!persisted) throw new Error("MCP_INVOCATION_SUPERSEDED");
      await ctx.runMutation(internal.mcp.lifecycle_mutations.startStandaloneInvocation, {
        userId,
        publicId,
      });
      return { invocationId: publicId, state: "task_pending", result };
    }
    const mapped = args.kind === "tool"
      ? undefined
      : await mapMcpInvocationContent({
          ctx,
          result,
          serverName: mcpConnectionDisplayName(connection),
          itemName: mcpCatalogItemDisplayName(item),
          kind: args.kind,
        });
    mappedContentItems = mapped?.contentItems;
    contentPersisted = await ctx.runMutation(internal.mcp.invocation_mutations.finishInvocation, {
      invocationId,
      state: "completed",
      result,
      contextText: mapped?.contextText,
      contentItems: mapped?.contentItems,
    });
    if (!contentPersisted) throw new Error("MCP_INVOCATION_SUPERSEDED");
    return {
      invocationId: publicId,
      state: "completed",
      result,
      contextText: mapped?.contextText,
      contentItems: mapped?.contentItems,
    };
  } catch (error) {
    if (!contentPersisted) await deleteMcpInvocationContent(ctx, mappedContentItems);
    const failureState = remoteToolDispatched ? "outcome_unknown" : "failed";
    await ctx.runMutation(internal.mcp.invocation_mutations.finishInvocation, {
      invocationId,
      state: failureState,
      errorCode: failureState === "outcome_unknown"
        ? "MCP_REMOTE_OUTCOME_UNKNOWN"
        : "MCP_INVOCATION_FAILED",
    });
    if (connection.authMode === "oauth" && isMcpAuthenticationError(error)) {
      await ctx.runMutation(internal.mcp.mutations.markConnectionFailure, {
        connectionId: connection._id,
        status: "auth_required",
        errorCode: "MCP_AUTH_REQUIRED",
      });
    }
    throw new ConvexError({
      code: "MCP_INVOCATION_FAILED",
      message: "The Remote MCP request failed safely.",
    });
  } finally {
    if (opened) await opened.close();
  }
}
