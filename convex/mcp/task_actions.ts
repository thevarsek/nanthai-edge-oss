"use node";

import { ConvexError, v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import { loadMcpCredential } from "./credentials";
import { sendTaskRequest } from "./tasks_client";
import { deleteMcpInvocationContent, mapMcpInvocationContent } from "./content_mapping";
import { mcpCatalogItemDisplayName, mcpConnectionDisplayName } from "./display";
import { serializeBoundedMcpResult } from "./policy";
import { mcpOperationInputHash } from "./operation_hash";
import { settleMcpInvocation } from "./settlement";

type TaskState = "completed" | "failed" | "cancelled" | "awaiting_input" | "task_pending";

function taskState(status: string): TaskState {
  if (status === "completed" || status === "failed" || status === "cancelled") return status;
  return status === "input_required" ? "awaiting_input" : "task_pending";
}

function isTerminal(state: TaskState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

export const updateTask = action({
  args: {
    invocationId: v.string(),
    operation: v.union(v.literal("get"), v.literal("update"), v.literal("cancel")),
    inputResponses: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    if (args.operation !== "cancel") {
      await ctx.runQuery(internal.mcp.queries.assertPro, { userId });
    }
    const invocation = await ctx.runQuery(internal.mcp.queries.getOwnedInvocationInternal, {
      userId,
      publicId: args.invocationId,
    });
    if (!invocation?.taskId) {
      throw new ConvexError({ code: "MCP_TASK_NOT_FOUND", message: "Remote MCP task not found." });
    }
    const connection = await ctx.runQuery(internal.mcp.queries.getOwnedConnectionById, {
      userId,
      connectionId: invocation.connectionId,
    });
    if (!connection || connection.status !== "active") {
      throw new ConvexError({ code: "MCP_DISABLED", message: "Remote MCP server is disabled." });
    }
    if (args.operation !== "cancel") {
      const stableKey = invocation.catalogStableKey ?? (
        invocation.catalogItemId
          ? await ctx.runQuery(internal.mcp.queries.getCatalogItemStableKey, {
              itemId: invocation.catalogItemId,
            })
          : null
      );
      const item = stableKey
        ? await ctx.runQuery(internal.mcp.queries.getAllowedItem, {
            userId,
            connectionId: invocation.connectionId,
            stableKey,
          })
        : null;
      if (!item) {
        throw new ConvexError({
          code: "MCP_DISABLED",
          message: "This Remote MCP item is disabled.",
        });
      }
    }
    const taskId = invocation.taskId;
    const method = `tasks/${args.operation}` as "tasks/get" | "tasks/update" | "tasks/cancel";
    const operationKey = `remote-mcp-task-user:${String(invocation._id)}:${args.operation}:${invocation.updatedAt}`;
    const claimed = await ctx.runMutation(
      internal.mcp.invocation_mutations.claimInvocationOperation,
      {
        invocationId: invocation._id,
        operationKey,
        mode: `task_${args.operation}` as "task_get" | "task_update" | "task_cancel",
      },
    );
    if (!claimed) {
      throw new ConvexError({
        code: "MCP_TASK_ALREADY_HANDLED",
        message: "This Remote MCP task action is already being handled.",
      });
    }
    const execution = invocation.durableAttemptId && invocation.durableFence !== undefined
      ? { attemptId: invocation.durableAttemptId, fence: invocation.durableFence }
      : undefined;
    let remoteDispatched = false;
    let result: Record<string, unknown>;
    try {
      const resumed = await ctx.runMutation(
        internal.mcp.lifecycle_mutations.resumeInvocationOperation,
        { userId, invocationId: invocation._id, operationKey },
      );
      if (!resumed) throw new Error("MCP_TASK_EXECUTION_UNAVAILABLE");
      if (execution) {
        const decision = await ctx.runMutation(internal.execution.operations.prepare, {
          attemptId: execution.attemptId,
          fence: execution.fence,
          operationKey,
          toolName: `remote_mcp_${method.replace("/", "_")}`,
          toolCallId: operationKey,
          effect: args.operation === "get" ? "read" : "write",
          retry: args.operation === "get" ? "safe" : "never",
          authorizationSource: "interactive_confirmation",
          inputHash: mcpOperationInputHash({ taskId, inputResponses: args.inputResponses }),
        });
        if (decision.decision !== "execute") throw new Error("MCP_TASK_REPLAY_BLOCKED");
        await ctx.runMutation(internal.execution.operations.markDispatched, {
          attemptId: execution.attemptId,
          fence: execution.fence,
          operationKey,
        });
      }
      const credential = await loadMcpCredential(ctx, userId, connection._id);
      remoteDispatched = true;
      result = await sendTaskRequest({
        endpoint: connection.endpoint,
        method,
        taskId,
        inputResponses: args.inputResponses,
        credential,
      });
      if (execution) {
        const resultJson = serializeBoundedMcpResult(result);
        await ctx.runMutation(internal.execution.operations.complete, {
          attemptId: execution.attemptId,
          fence: execution.fence,
          operationKey,
          externalId: taskId,
          resultJson,
        }).catch(async () => await ctx.runMutation(
          internal.execution.operations.recordObservedExternalOutcome,
          { attemptId: execution.attemptId, operationKey, externalId: taskId, resultJson },
        ));
      }
    } catch {
      if (execution) {
        const mutation = args.operation === "get"
          ? internal.execution.operations.resetSafeFailure
          : internal.execution.operations.markOutcomeUnknown;
        await ctx.runMutation(mutation, {
          attemptId: execution.attemptId,
          fence: execution.fence,
          operationKey,
          errorSummary: "Remote MCP task action failed after dispatch.",
        }).catch(() => undefined);
      }
      if (args.operation === "get" || !remoteDispatched) {
        await ctx.runMutation(internal.mcp.lifecycle_mutations.releaseTaskOperation, {
          userId,
          invocationId: invocation._id,
          operationKey,
          state: invocation.state as "awaiting_input" | "task_pending",
        }).catch(() => undefined);
      } else {
        const persisted = await ctx.runMutation(internal.mcp.invocation_mutations.finishInvocation, {
          invocationId: invocation._id,
          state: "outcome_unknown",
          expectedOperationKey: operationKey,
          errorCode: "MCP_REMOTE_OUTCOME_UNKNOWN",
        }).catch(() => false);
        if (persisted) await settleMcpInvocation(ctx, invocation).catch(() => undefined);
      }
      throw new ConvexError({ code: "MCP_TASK_FAILED", message: "The Remote MCP task request failed safely." });
    }

    const status = typeof result.status === "string" ? result.status : "working";
    const state = taskState(status);
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
    let persisted: boolean;
    try {
      persisted = await ctx.runMutation(internal.mcp.invocation_mutations.finishInvocation, {
        invocationId: invocation._id,
        state,
        taskId,
        taskStatus: status,
        inputRequests: result.inputRequests,
        result,
        contextText: mapped?.contextText,
        contentItems: mapped?.contentItems,
        errorCode: state === "failed" ? "MCP_REMOTE_TASK_FAILED" : undefined,
        expectedOperationKey: operationKey,
      });
    } catch (error) {
      await deleteMcpInvocationContent(ctx, mapped?.contentItems);
      throw error;
    }
    if (!persisted) {
      await deleteMcpInvocationContent(ctx, mapped?.contentItems);
      throw new ConvexError({
        code: "MCP_TASK_SUPERSEDED",
        message: "This Remote MCP task changed while the request was running.",
      });
    }
    if (isTerminal(state)) {
      await settleMcpInvocation(ctx, invocation);
    } else if (args.operation === "get" && state === "awaiting_input") {
      await ctx.runMutation(internal.mcp.lifecycle_mutations.restoreTaskInputWait, {
        invocationId: invocation._id,
        userId,
      });
    } else {
      await ctx.runMutation(internal.mcp.task_lifecycle.signalTaskInput, {
        invocationId: invocation._id,
        userId,
        action: "continue",
      });
    }
    return { invocationId: args.invocationId, state, result };
  },
});
