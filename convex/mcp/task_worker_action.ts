"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { loadMcpCredential } from "./credentials";
import { sendTaskRequest } from "./tasks_client";
import { deleteMcpInvocationContent, mapMcpInvocationContent } from "./content_mapping";
import { mcpCatalogItemDisplayName, mcpConnectionDisplayName } from "./display";

const executionRef = v.object({
  runId: v.id("executionRuns"),
  attemptId: v.id("executionAttempts"),
  fence: v.number(),
  claimantId: v.string(),
});

export type RemoteTaskPollState = "missing" | "disabled" | "completed" | "failed"
  | "cancelled" | "outcome_unknown" | "awaiting_input" | "task_pending" | "retry";

export const pollRemoteTask = internalAction({
  args: {
    invocationId: v.id("mcpInvocations"),
    execution: executionRef,
    operationKey: v.string(),
  },
  handler: async (ctx, args): Promise<{ state: RemoteTaskPollState }> => {
    let mappedContentItems: Awaited<ReturnType<typeof mapMcpInvocationContent>>["contentItems"]
      | undefined;
    const invocation: Doc<"mcpInvocations"> | null = await ctx.runQuery(
      internal.mcp.queries.getInvocationByIdInternal,
      {
      invocationId: args.invocationId,
      },
    );
    if (!invocation?.taskId || invocation.durableRunId !== args.execution.runId) {
      return { state: "missing" as const };
    }
    if (invocation.state === "completed") return { state: "completed" };
    if (invocation.state === "failed") return { state: "failed" };
    if (invocation.state === "cancelled") return { state: "cancelled" };
    if (invocation.state === "outcome_unknown") return { state: "outcome_unknown" };
    if (invocation.state === "dispatching") return { state: "retry" };
    const connection = await ctx.runQuery(internal.mcp.queries.getOwnedConnectionById, {
      userId: invocation.userId,
      connectionId: invocation.connectionId,
    });
    if (!connection || connection.status !== "active") {
      return { state: "disabled" as const };
    }
    const stableKey = invocation.catalogStableKey ?? (
      invocation.catalogItemId
        ? await ctx.runQuery(internal.mcp.queries.getCatalogItemStableKey, {
            itemId: invocation.catalogItemId,
          })
        : null
    );
    const allowedItem = stableKey
      ? await ctx.runQuery(internal.mcp.queries.getAllowedItem, {
          userId: invocation.userId,
          connectionId: invocation.connectionId,
          stableKey,
        })
      : null;
    if (!allowedItem) return { state: "disabled" as const };
    const claimed = await ctx.runMutation(
      internal.mcp.invocation_mutations.claimInvocationOperation,
      {
        invocationId: invocation._id,
        operationKey: args.operationKey,
        mode: "task_get",
      },
    );
    if (!claimed) return { state: "retry" as const };
    try {
      const credential = await loadMcpCredential(ctx, invocation.userId, connection._id);
      const result = await sendTaskRequest({
        endpoint: connection.endpoint,
        method: "tasks/get",
        taskId: invocation.taskId,
        credential,
      });
      const status = typeof result.status === "string" ? result.status : "working";
      const state = status === "completed"
        ? "completed"
        : status === "failed"
          ? "failed"
          : status === "cancelled"
            ? "cancelled"
            : status === "input_required"
              ? "awaiting_input"
              : "task_pending";
      const itemName = invocation.itemName ?? (invocation.catalogItemId
        ? mcpCatalogItemDisplayName(await ctx.runQuery(
            internal.mcp.queries.getCatalogItemByIdInternal,
            { itemId: invocation.catalogItemId },
          ) ?? { remoteName: "Remote MCP item" })
        : "Remote MCP item");
      const mapped = state === "completed" && invocation.kind !== "tool"
        ? await mapMcpInvocationContent({
            ctx,
            result,
            serverName: mcpConnectionDisplayName(connection),
            itemName,
            kind: invocation.kind,
        })
        : undefined;
      mappedContentItems = mapped?.contentItems;
      const persisted = await ctx.runMutation(internal.mcp.invocation_mutations.finishInvocation, {
        invocationId: invocation._id,
        state,
        taskId: invocation.taskId,
        taskStatus: status,
        inputRequests: result.inputRequests,
        result,
        contextText: mapped?.contextText,
        contentItems: mapped?.contentItems,
        errorCode: state === "failed" ? "MCP_REMOTE_TASK_FAILED" : undefined,
        expectedOperationKey: args.operationKey,
      });
      if (!persisted) {
        await deleteMcpInvocationContent(ctx, mapped?.contentItems);
        return { state: "retry" as const };
      }
      return { state };
    } catch {
      await deleteMcpInvocationContent(ctx, mappedContentItems);
      await ctx.runMutation(internal.mcp.invocation_mutations.releaseInvocationOperation, {
        invocationId: invocation._id,
        operationKey: args.operationKey,
        state: invocation.state as "awaiting_input" | "task_pending",
      }).catch(() => undefined);
      return { state: "retry" as const };
    }
  },
});
