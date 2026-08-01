"use node";

import { ConvexError, v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import { loadMcpCredential } from "./credentials";
import { mcpJsonFromStorage } from "./json_codec";
import { openMcpClient } from "./sdk_client";
import { serializeBoundedMcpResult } from "./policy";
import {
  deleteMcpInvocationContent,
  mapMcpInvocationContent,
  type McpInvocationContentItem,
} from "./content_mapping";
import { mcpCatalogItemDisplayName, mcpConnectionDisplayName } from "./display";
import { mcpOperationInputHash } from "./operation_hash";
import { queueMcpInvocationSettlement, settleMcpInvocation } from "./settlement";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export const respondToInput = action({
  args: {
    invocationId: v.string(),
    inputResponses: v.any(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const { userId } = await requireAuth(ctx);
    await ctx.runQuery(internal.mcp.queries.assertPro, { userId });
    const invocation = await ctx.runQuery(internal.mcp.queries.getOwnedInvocationInternal, {
      userId,
      publicId: args.invocationId,
    });
    if (!invocation || invocation.state !== "awaiting_input") {
      throw new ConvexError({ code: "MCP_INPUT_NOT_FOUND", message: "Pending Remote MCP input was not found." });
    }
    if (invocation.taskId) {
      throw new ConvexError({
        code: "MCP_TASK_INPUT_REQUIRED",
        message: "Use the Remote MCP task controls to answer this request.",
      });
    }
    const connection = await ctx.runQuery(internal.mcp.queries.getOwnedConnectionById, {
      userId,
      connectionId: invocation.connectionId,
    });
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
    if (!connection || connection.status !== "active" || !item) {
      throw new ConvexError({ code: "MCP_DISABLED", message: "Remote MCP server or item is disabled." });
    }
    const operationKey = `remote-mcp-continuation:${String(invocation._id)}:${invocation.updatedAt}`;
    const claimed = await ctx.runMutation(
      internal.mcp.invocation_mutations.claimInvocationOperation,
      { invocationId: invocation._id, operationKey, mode: "continuation" },
    );
    if (!claimed) {
      throw new ConvexError({
        code: "MCP_INPUT_ALREADY_HANDLED",
        message: "This Remote MCP input is already being handled.",
      });
    }
    const requestParams = {
      ...record(mcpJsonFromStorage(invocation.requestParams)),
      requestState: mcpJsonFromStorage(invocation.requestState),
      inputResponses: args.inputResponses,
    };
    let opened: Awaited<ReturnType<typeof openMcpClient>> | undefined;
    let dispatched = false;
    let persisted = false;
    let terminalPersisted = false;
    let settlementAttempted = false;
    let remoteObserved = false;
    let mappedContentItems: McpInvocationContentItem[] | undefined;
    const execution = invocation.durableAttemptId && invocation.durableFence !== undefined
      ? { attemptId: invocation.durableAttemptId, fence: invocation.durableFence }
      : undefined;
    try {
      if (!execution || !await ctx.runMutation(
        internal.mcp.lifecycle_mutations.resumeInvocationOperation,
        { userId, invocationId: invocation._id, operationKey },
      )) {
        throw new Error("MCP_CONTINUATION_EXECUTION_UNAVAILABLE");
      }
      const decision = await ctx.runMutation(internal.execution.operations.prepare, {
        attemptId: execution.attemptId,
        fence: execution.fence,
        operationKey,
        toolName: `remote_mcp_${invocation.method.replace("/", "_")}_continuation`,
        toolCallId: operationKey,
        effect: invocation.kind === "tool" ? "write" : "read",
        retry: invocation.kind === "tool" ? "never" : "safe",
        authorizationSource: "interactive_confirmation",
        inputHash: mcpOperationInputHash({
          requestState: mcpJsonFromStorage(invocation.requestState),
          inputResponses: args.inputResponses,
        }),
      });
      if (decision.decision !== "execute") {
        throw new Error("MCP_CONTINUATION_REPLAY_BLOCKED");
      }
      await ctx.runMutation(internal.execution.operations.markDispatched, {
        attemptId: execution.attemptId,
        fence: execution.fence,
        operationKey,
      });
      const credential = await loadMcpCredential(ctx, userId, connection._id);
      opened = await openMcpClient({
        endpoint: connection.endpoint,
        cachePartition: `${userId}:${connection.publicId}`,
        credential,
      });
      dispatched = true;
      const result = invocation.kind === "tool"
        ? await opened.client.callTool(requestParams as never, {
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
          })
        : invocation.kind === "prompt"
          ? await opened.client.getPrompt(requestParams as never, {
              timeout: 55_000,
              maxTotalTimeout: 55_000,
              allowInputRequired: true,
            })
          : await opened.client.readResource(requestParams as never, {
              timeout: 55_000,
              maxTotalTimeout: 55_000,
              allowInputRequired: true,
              cacheMode: "refresh",
            });
      const resultJson = serializeBoundedMcpResult(result);
      remoteObserved = true;
      if (execution) {
        await ctx.runMutation(internal.execution.operations.complete, {
          attemptId: execution.attemptId,
          fence: execution.fence,
          operationKey,
          externalId: invocation.taskId,
          resultJson,
        }).catch(async () => await ctx.runMutation(
          internal.execution.operations.recordObservedExternalOutcome,
          {
            attemptId: execution.attemptId,
            operationKey,
            externalId: invocation.taskId ?? invocation.publicId,
            resultJson,
          },
        ));
      }
      const resultRecord = record(result);
      const resultType = resultRecord.resultType;
      if (resultType === "input_required") {
        persisted = await ctx.runMutation(internal.mcp.invocation_mutations.finishInvocation, {
          invocationId: invocation._id,
          state: "awaiting_input",
          requestState: resultRecord.requestState,
          inputRequests: resultRecord.inputRequests,
          expectedOperationKey: operationKey,
        });
        if (!persisted) throw new Error("MCP_CONTINUATION_SUPERSEDED");
        await ctx.runMutation(internal.mcp.lifecycle_mutations.startStandaloneInvocation, {
          userId,
          publicId: invocation.publicId,
        });
        return {
          invocationId: invocation.publicId,
          state: "awaiting_input",
          inputRequests: resultRecord.inputRequests,
          requestState: resultRecord.requestState,
        };
      }
      if (resultType === "task") {
        persisted = await ctx.runMutation(internal.mcp.invocation_mutations.finishInvocation, {
          invocationId: invocation._id,
          state: "task_pending",
          taskId: typeof resultRecord.taskId === "string" ? resultRecord.taskId : undefined,
          taskStatus: typeof resultRecord.status === "string" ? resultRecord.status : "working",
          result,
          expectedOperationKey: operationKey,
        });
        if (!persisted) throw new Error("MCP_CONTINUATION_SUPERSEDED");
        if (invocation.parentResumeEventId && invocation.generationJobId && invocation.toolCallId) {
          await ctx.runMutation(internal.mcp.lifecycle_mutations.bindDeferredInvocation, {
            userId,
            publicId: invocation.publicId,
            jobId: invocation.generationJobId,
            toolCallId: invocation.toolCallId,
            parentResumeEventId: invocation.parentResumeEventId,
          });
        } else {
          await ctx.runMutation(internal.mcp.lifecycle_mutations.startStandaloneInvocation, {
            userId,
            publicId: invocation.publicId,
          });
        }
        return { invocationId: invocation.publicId, state: "task_pending", result };
      }
      const mapped = invocation.kind === "tool" ? undefined : await mapMcpInvocationContent({
        ctx,
        result,
        serverName: mcpConnectionDisplayName(connection),
        itemName: mcpCatalogItemDisplayName(item),
        kind: invocation.kind,
      });
      mappedContentItems = mapped?.contentItems;
      persisted = await ctx.runMutation(internal.mcp.invocation_mutations.finishInvocation, {
        invocationId: invocation._id,
        state: "completed",
        result,
        expectedOperationKey: operationKey,
        ...mapped,
      });
      if (!persisted) throw new Error("MCP_CONTINUATION_SUPERSEDED");
      terminalPersisted = true;
      settlementAttempted = true;
      await settleMcpInvocation(ctx, invocation);
      return { invocationId: invocation.publicId, state: "completed", result };
    } catch {
      if (!persisted) await deleteMcpInvocationContent(ctx, mappedContentItems);
      if (execution && !remoteObserved) {
        const mutation = invocation.kind === "tool"
          ? internal.execution.operations.markOutcomeUnknown
          : internal.execution.operations.resetSafeFailure;
        await ctx.runMutation(mutation, {
          attemptId: execution.attemptId,
          fence: execution.fence,
          operationKey,
          errorSummary: "Remote MCP continuation failed after dispatch.",
        }).catch(() => undefined);
      }
      if (!persisted) {
        const state = dispatched && invocation.kind === "tool" ? "outcome_unknown" : "failed";
        persisted = await ctx.runMutation(internal.mcp.invocation_mutations.finishInvocation, {
          invocationId: invocation._id,
          state,
          expectedOperationKey: operationKey,
          errorCode: state === "outcome_unknown"
            ? "MCP_REMOTE_OUTCOME_UNKNOWN"
            : "MCP_INVOCATION_FAILED",
        }).catch(() => false);
        terminalPersisted = persisted;
      }
      if (terminalPersisted) {
        await queueMcpInvocationSettlement(ctx, invocation);
        if (!settlementAttempted) {
          await settleMcpInvocation(ctx, invocation).catch(() => undefined);
        }
      }
      throw new ConvexError({
        code: persisted ? "MCP_CONTINUATION_SYNC_FAILED" : "MCP_INVOCATION_FAILED",
        message: persisted
          ? "The Remote MCP request completed, but NanthAI could not resume the chat yet."
          : "The Remote MCP request failed safely.",
      });
    } finally {
      if (opened) await opened.close();
    }
  },
});
