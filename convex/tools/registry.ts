// convex/tools/registry.ts
// =============================================================================
// Tool registry for the OpenRouter tool-calling pipeline.
//
// Tools are defined via `createTool()` and collected in a `ToolRegistry`.
// The registry converts tools to OpenRouter `ToolDefinition[]` for the request
// and dispatches tool-call execution by name.
// =============================================================================

import { ConvexError } from "convex/values";
import { ActionCtx } from "../_generated/server";
import { ToolCall, ToolDefinition } from "../lib/openrouter_types";
import type { Sandbox } from "just-bash";

// ---------------------------------------------------------------------------
// Tool definition types
// ---------------------------------------------------------------------------

/**
 * JSON Schema for tool parameters, sent to the model so it knows what
 * arguments to produce. Uses the standard JSON Schema subset that OpenAI
 * and OpenRouter support.
 */
export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/** Result returned by a tool's `execute` function. */
export interface ToolResult {
  /** Whether the tool executed successfully. */
  success: boolean;
  /** Serializable data to feed back to the model as the tool response. */
  data: unknown;
  /** Optional human-readable error message (when success=false). */
  error?: string;
  /**
   * Optional deferred payload. When present, the caller may persist the tool
   * result and resume the parent workflow later instead of immediately
   * re-calling the model in the same action.
   */
  deferred?: ToolDeferredPayload;
}

export interface ToolDeferredPayload {
  kind: "spawn_subagents" | "drive_picker";
  data: unknown;
}

/**
 * Context passed to every tool execution. Provides Convex ActionCtx plus
 * user-scoped metadata needed for authorization and file storage.
 */
export interface ToolExecutionContext {
  ctx: ActionCtx;
  userId: string;
  chatId?: string;
  /**
   * The Convex ID of the current sandbox session (if a Vercel sandbox is
   * active for this chat). Set by data_python_sandbox after session upsert
   * so artifact recording can link rows to the session for proper cascade
   * deletion on account purge.
   */
  sandboxSessionId?: string;
  /**
   * Shared just-bash Sandbox for workspace tools within a single generation.
   * Lazy-created on first workspace tool call and reused for all subsequent
   * calls. The sandbox's in-memory filesystem persists across tool calls,
   * eliminating per-call re-seeding.
   *
   * Callers MUST call `workspaceSandboxCleanup()` when the generation ends.
   */
  workspaceSandbox?: Sandbox;
  /**
   * Cleanup function that stops the workspace sandbox. Must be called in a
   * finally block when the generation run completes (success or error).
   */
  workspaceSandboxCleanup?: () => Promise<void>;
}

/** Definition passed to `createTool()`. */
export interface ToolConfig {
  /** Unique tool name (snake_case by convention, e.g. "generate_docx"). */
  name: string;
  /** Human-readable description shown to the model. */
  description: string;
  /** JSON Schema describing the tool's parameters. */
  parameters: ToolParameterSchema;
  /**
   * Execute the tool. Receives Convex context and the parsed arguments
   * object (already JSON.parse'd from the model's arguments string).
   */
  execute: (
    toolCtx: ToolExecutionContext,
    args: Record<string, unknown>,
  ) => Promise<ToolResult>;
}

/** An immutable, registered tool ready for use. */
export interface RegisteredTool {
  readonly name: string;
  readonly definition: ToolDefinition;
  readonly execute: ToolConfig["execute"];
}

// ---------------------------------------------------------------------------
// createTool — convenience factory
// ---------------------------------------------------------------------------

/**
 * Create a tool definition. Returns a `RegisteredTool` that can be added to
 * a `ToolRegistry`.
 *
 * ```ts
 * const myTool = createTool({
 *   name: "generate_docx",
 *   description: "Generate a Word document",
 *   parameters: {
 *     type: "object",
 *     properties: {
 *       title: { type: "string", description: "Document title" },
 *     },
 *     required: ["title"],
 *   },
 *   execute: async (toolCtx, args) => {
 *     // ... generate file, store in Convex ...
 *     return { success: true, data: { storageId, url } };
 *   },
 * });
 * ```
 */
export function createTool(config: ToolConfig): RegisteredTool {
  return {
    name: config.name,
    definition: {
      type: "function",
      function: {
        name: config.name,
        description: config.description,
        parameters: config.parameters as unknown as Record<string, unknown>,
      },
    },
    execute: config.execute,
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

    try {
      const result = await tool.execute(toolCtx, parsedArgs);
      return { toolCallId: toolCall.id, result };
    } catch (e) {
      return {
        toolCallId: toolCall.id,
        result: {
          success: false,
          data: null,
          error: `Tool "${toolCall.function.name}" threw: ${e instanceof Error ? e.message : String(e)}`,
        },
      };
    }
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
    const results = new Array<{
      toolCallId: string;
      result: ToolResult;
    }>(toolCalls.length);

    let serializedChain = Promise.resolve();

    const shouldSerialize = (toolName: string): boolean =>
      toolName.startsWith("notion_") ||
      toolName.startsWith("workspace_") ||
      toolName.startsWith("vm_") ||
      toolName === "data_python_exec" ||
      toolName === "data_python_sandbox" ||
      toolName === "read_pdf" ||
      toolName === "generate_pdf" ||
      toolName === "edit_pdf";

    await Promise.all(
      toolCalls.map((tc, index) => {
        if (!shouldSerialize(tc.function.name)) {
          return this.executeToolCall(tc, toolCtx).then((result) => {
            results[index] = result;
          });
        }

        const run = serializedChain.then(() => this.executeToolCall(tc, toolCtx));
        serializedChain = run.then(
          () => undefined,
          () => undefined,
        );

        return run.then((result) => {
          results[index] = result;
        });
      }),
    );

    return results;
  }
}
