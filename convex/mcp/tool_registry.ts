import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createTool, type ToolParameterSchema, type ToolRegistry } from "../tools/registry";
import { mcpJsonFromStorage } from "./json_codec";

export interface RemoteMcpToolDefinition {
  connectionId: string;
  integrationId: string;
  integrationName: string;
  stableKey: string;
  remoteName: string;
  displayName: string;
  alias?: string;
  description?: string;
  inputSchema?: unknown;
}

function parameters(value: unknown): ToolParameterSchema {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { type: "object", properties: {}, additionalProperties: false };
  }
  const schema = value as Record<string, unknown>;
  const properties = typeof schema.properties === "object" && schema.properties !== null
    ? schema.properties as Record<string, unknown>
    : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  return { type: "object", properties, required, additionalProperties: schema.additionalProperties === true };
}

export function registerRemoteMcpTools(
  registry: ToolRegistry,
  definitions: RemoteMcpToolDefinition[],
): void {
  const availableSlots = Math.max(0, 128 - registry.size);
  for (const definition of definitions.slice(0, availableSlots)) {
    if (!definition.alias || registry.get(definition.alias)) continue;
    registry.register(createTool({
      name: definition.alias,
      description: `[Remote MCP: ${definition.integrationName}] ${definition.description ?? definition.remoteName}`.slice(0, 2000),
      parameters: parameters(mcpJsonFromStorage(definition.inputSchema)),
      effectPolicy: { effect: "write", retry: "never" },
      execute: async (toolCtx, args) => {
        const outcome = await toolCtx.ctx.runAction(internal.mcp.tool_action.invokeAllowedTool, {
          userId: toolCtx.userId,
          connectionPublicId: definition.connectionId,
          stableKey: definition.stableKey,
          arguments: args,
          chatId: toolCtx.chatId as Id<"chats"> | undefined,
          messageId: toolCtx.messageId as Id<"messages"> | undefined,
          generationJobId: toolCtx.jobId as Id<"generationJobs"> | undefined,
          attemptId: toolCtx.executionAttemptId,
          fence: toolCtx.executionFence,
          operationKey: toolCtx.operationIdempotencyKey,
          toolCallId: toolCtx.toolCallId,
        });
        if (outcome.state === "awaiting_input" || outcome.state === "task_pending") {
          return {
            success: true,
            data: {
              invocationId: outcome.invocationId,
              state: outcome.state,
              message: outcome.state === "awaiting_input"
                ? "Waiting for user input in NanthAI."
                : "The remote task is running.",
            },
            deferred: {
              kind: "remote_mcp",
              data: { invocationId: outcome.invocationId },
            },
          };
        }
        return {
          success: true,
          data: outcome.result,
          artifactData: { invocationId: outcome.invocationId, result: outcome.result },
        };
      },
    }));
  }
}
