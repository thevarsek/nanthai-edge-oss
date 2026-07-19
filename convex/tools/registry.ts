import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { ToolCall, ToolDefinition } from "../lib/openrouter_types";
import { artifactWriteBlockMessage } from "./artifact_write_policy";
import { internal } from "../_generated/api";
import { declaredToolEffectPolicy } from "./effect_policy_inventory";
import type {
  RegisteredTool,
  ToolConfig,
  ToolExecutionContext,
  ToolParameterSchema,
  ToolResult,
} from "./registry_types";
import { executeToolCallBatch } from "./tool_call_batch";
import { canonicalizeRawJson, stableJsonStringify } from "./stable_json";
export type {
  PresentationToolContext,
  RegisteredTool,
  ToolConfig,
  ToolDeferredPayload,
  ToolExecutionContext,
  ToolParameterSchema,
  ToolResult,
} from "./registry_types";

export function createTool(config: ToolConfig): RegisteredTool {
  const parameters: ToolParameterSchema = {
    ...config.parameters,
    additionalProperties: config.parameters.additionalProperties ?? false,
  };

  return {
    name: config.name,
    definition: {
      type: "function",
      function: {
        name: config.name,
        description: config.description,
        parameters: parameters as unknown as Record<string, unknown>,
      },
    },
    execute: config.execute,
    effectPolicy: config.effectPolicy ?? declaredToolEffectPolicy(config.name),
    mayDefer: config.mayDefer === true,
  };
}

// ---------------------------------------------------------------------------
// ToolRegistry — collects tools and dispatches execution
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  /** Register one or more tools. Duplicate names throw. */
  register(...tools: RegisteredTool[]): void {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new ConvexError({
          code: "DUPLICATE_TOOL" as const,
          message: `Tool "${tool.name}" is already registered`,
        });
      }
      this.tools.set(tool.name, tool);
    }
  }

  /** Get the OpenRouter `tools` array for the API request. */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /** Check whether any tools are registered. */
  get isEmpty(): boolean {
    return this.tools.size === 0;
  }

  /** Number of registered tools. */
  get size(): number {
    return this.tools.size;
  }

  /** Look up a tool by name. Returns undefined if not found. */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Execute a single tool call. Parses the JSON arguments, invokes the
   * tool's execute function, and returns a formatted result.
   *
   * If the tool is not found or arguments fail to parse, returns an error
   * result rather than throwing — the model should see the error and adapt.
   */
  async executeToolCall(
    toolCall: ToolCall,
    toolCtx: ToolExecutionContext,
    operationOccurrence = 0,
  ): Promise<{ toolCallId: string; result: ToolResult }> {
    const tool = this.tools.get(toolCall.function.name);
    if (!tool) {
      return {
        toolCallId: toolCall.id,
        result: {
          success: false,
          data: null,
          error: `Unknown tool: "${toolCall.function.name}". Available tools: ${Array.from(this.tools.keys()).join(", ")}`,
        },
      };
    }

    const artifactWriteBlock = artifactWriteBlockMessage(tool.name, toolCtx);
    if (artifactWriteBlock) {
      return {
        toolCallId: toolCall.id,
        result: {
          success: false,
          data: null,
          error: artifactWriteBlock,
        },
      };
    }

    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      return {
        toolCallId: toolCall.id,
        result: {
          success: false,
          data: null,
          error: `Failed to parse arguments for tool "${toolCall.function.name}": ${e instanceof Error ? e.message : String(e)}`,
        },
      };
    }

    const canonicalArguments = stableJsonStringify(parsedArgs);
    const inputHash = await sha256Hex(`${tool.name}\n${canonicalArguments}`);
    const scopeHash = toolCtx.operationScope
      ? await sha256Hex(toolCtx.operationScope)
      : undefined;
    const operationKey = toolCtx.jobId
      ? tool.effectPolicy.effect === "read"
        ? `${toolCtx.jobId}:${toolCall.id}`
        : [toolCtx.jobId, tool.name, inputHash, scopeHash, operationOccurrence]
            .filter((part) => part !== undefined)
            .join(":")
      : undefined;
    const executionIdentity = operationKey && toolCtx.jobId &&
      toolCtx.executionAttemptId && toolCtx.executionFence !== undefined
      ? {
          operationKey,
          jobId: toolCtx.jobId as Id<"generationJobs">,
          attemptId: toolCtx.executionAttemptId,
          fence: toolCtx.executionFence,
        }
      : null;
    if (executionIdentity) {
      const decision = await toolCtx.ctx.runMutation(internal.execution.operations.prepare, {
        jobId: executionIdentity.jobId,
        attemptId: executionIdentity.attemptId,
        fence: executionIdentity.fence,
        operationKey: executionIdentity.operationKey,
        toolName: tool.name,
        toolCallId: toolCall.id,
        effect: tool.effectPolicy.effect,
        retry: tool.effectPolicy.retry,
        authorizationSource: toolCtx.authorizationSource ?? "explicit_user_turn",
        inputHash,
      });
      if (decision.decision === "refuse") {
        return {
          toolCallId: toolCall.id,
          result: { success: false, data: null, error: decision.reason },
        };
      }
      if (decision.decision === "replay") {
        return {
          toolCallId: toolCall.id,
          result: JSON.parse(decision.resultJson) as ToolResult,
        };
      }
      await toolCtx.ctx.runMutation(internal.execution.operations.markDispatched, {
        attemptId: executionIdentity.attemptId,
        fence: executionIdentity.fence,
        operationKey: executionIdentity.operationKey,
      });
    }

    let result: ToolResult;
    try {
      result = await tool.execute(
        {
          ...toolCtx,
          toolCallId: toolCall.id,
          operationIdempotencyKey: executionIdentity?.operationKey,
        },
        parsedArgs,
      );
    } catch (e) {
      if (executionIdentity) {
        const errorSummary = e instanceof Error ? e.message : String(e);
        if (tool.effectPolicy.retry === "safe") {
          await toolCtx.ctx.runMutation(internal.execution.operations.resetSafeFailure, {
            attemptId: executionIdentity.attemptId,
            fence: executionIdentity.fence,
            operationKey: executionIdentity.operationKey,
            errorSummary,
          }).catch(() => undefined);
        } else {
          await toolCtx.ctx.runMutation(internal.execution.operations.markOutcomeUnknown, {
            attemptId: executionIdentity.attemptId,
            fence: executionIdentity.fence,
            operationKey: executionIdentity.operationKey,
            errorSummary,
          }).catch(() => undefined);
        }
      }
      return {
        toolCallId: toolCall.id,
        result: {
          success: false,
          data: null,
          error: `Tool "${toolCall.function.name}" threw: ${e instanceof Error ? e.message : String(e)}`,
        },
      };
    }

    if (executionIdentity) {
      const resultJson = serializeToolResult(result);
      try {
        await toolCtx.ctx.runMutation(internal.execution.operations.complete, {
          attemptId: executionIdentity.attemptId,
          fence: executionIdentity.fence,
          operationKey: executionIdentity.operationKey,
          resultJson,
        });
      } catch {
        // The provider call succeeded, so a stale execution fence must not
        // misclassify the external effect as a provider failure. Persist the
        // observed outcome through the deliberately unfenced reconciliation
        // path; future attempts will replay/refuse rather than duplicate it.
        await toolCtx.ctx.runMutation(
          internal.execution.operations.recordObservedExternalOutcome,
          {
            attemptId: executionIdentity.attemptId,
            operationKey: executionIdentity.operationKey,
            externalId: `observed:${toolCall.id}`,
            resultJson,
          },
        );
      }
    }
    return { toolCallId: toolCall.id, result };
  }

  /**
   * Execute all tool calls from a single model response in parallel.
   * Parallel execution minimises latency when a round contains multiple calls.
   * Notion also has a provider-wide request gate in the HTTP client so
   * concurrent generations for the same user stay coordinated across actions.
   * We still serialize same-round Notion tool calls here to avoid avoidable
   * queue contention inside one model step.
   * Returns results in the same order as the input tool calls.
   */
  async executeAllToolCalls(
    toolCalls: ToolCall[],
    toolCtx: ToolExecutionContext,
  ): Promise<Array<{ toolCallId: string; result: ToolResult }>> {
    return await executeToolCallBatch(
      toolCalls,
      (name) => this.tools.get(name),
      canonicalizeRawJson,
      async (toolCall, occurrence) => await this.executeToolCall(
        toolCall,
        toolCtx,
        occurrence,
      ),
    );
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function serializeToolResult(result: ToolResult): string {
  const serialized = JSON.stringify(result);
  if (serialized.length <= 700_000) return serialized;
  return JSON.stringify({
    success: result.success,
    data: null,
    error: result.error,
    replayTruncated: true,
  });
}
