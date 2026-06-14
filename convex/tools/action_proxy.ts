import {
  type FunctionReference,
} from "convex/server";
import {
  createTool,
  type RegisteredTool,
  type ToolConfig,
  type ToolExecutionContext,
  type ToolResult,
} from "./registry";
import {
  serializableToolContext,
  type SerializableToolContext,
} from "./proxy_context";

export type ExecuteProxyToolArgs<TToolName extends string> = {
  toolName: TToolName;
  toolArgs: Record<string, unknown>;
  toolContext: SerializableToolContext;
};

export type InternalToolActionRef<TToolName extends string> = FunctionReference<
  "action",
  "internal",
  ExecuteProxyToolArgs<TToolName>,
  ToolResult
>;

export function createActionProxyTool<TToolName extends string>(
  executeToolRef: InternalToolActionRef<TToolName>,
  toolName: TToolName,
  config: Omit<ToolConfig, "execute">,
): RegisteredTool {
  return createTool({
    ...config,
    execute: async (
      toolCtx: ToolExecutionContext,
      args: Record<string, unknown>,
    ) =>
      await toolCtx.ctx.runAction(executeToolRef, {
        toolName,
        toolArgs: args,
        toolContext: serializableToolContext(toolCtx),
      }),
  });
}
