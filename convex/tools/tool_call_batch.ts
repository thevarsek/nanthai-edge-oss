import type { ToolCall } from "../lib/openrouter_types";
import type { RegisteredTool, ToolResult } from "./registry_types";

type ToolCallResult = { toolCallId: string; result: ToolResult };

function shouldSerialize(toolName: string): boolean {
  return toolName.startsWith("notion_")
    || toolName.startsWith("workspace_")
    || toolName.startsWith("vm_")
    || toolName === "data_python_exec"
    || toolName === "data_python_sandbox"
    || toolName === "read_pdf"
    || toolName === "generate_pdf"
    || toolName === "edit_pdf"
    || toolName === "propose_docx_edits";
}

export async function executeToolCallBatch(
  toolCalls: ToolCall[],
  getTool: (name: string) => RegisteredTool | undefined,
  canonicalizeArguments: (value: string) => string,
  execute: (toolCall: ToolCall, occurrence: number) => Promise<ToolCallResult>,
): Promise<ToolCallResult[]> {
  const results = new Array<ToolCallResult>(toolCalls.length);
  let serializedChain = Promise.resolve();
  let deferrableChain = Promise.resolve();
  let deferredOwnerIndex: number | undefined;
  const occurrenceByIdentity = new Map<string, number>();
  const occurrences = toolCalls.map((toolCall) => {
    const identity = `${toolCall.function.name}\n${canonicalizeArguments(
      toolCall.function.arguments,
    )}`;
    const occurrence = occurrenceByIdentity.get(identity) ?? 0;
    occurrenceByIdentity.set(identity, occurrence + 1);
    return occurrence;
  });

  await Promise.all(toolCalls.map((toolCall, index) => {
    if (getTool(toolCall.function.name)?.mayDefer) {
      const run = deferrableChain.then(async () => {
        if (deferredOwnerIndex !== undefined) {
          results[index] = {
            toolCallId: toolCall.id,
            result: {
              success: false,
              data: null,
              error:
                "Only one durable deferred tool can start in a single tool round. "
                + `The earlier call at index ${deferredOwnerIndex} owns this round; `
                + "retry this tool after it resumes.",
            },
          };
          return;
        }
        const result = await execute(toolCall, occurrences[index]);
        results[index] = result;
        if (result.result.deferred) deferredOwnerIndex = index;
      });
      deferrableChain = run.then(() => undefined, () => undefined);
      return run;
    }
    if (!shouldSerialize(toolCall.function.name)) {
      return execute(toolCall, occurrences[index]).then((result) => {
        results[index] = result;
      });
    }
    const run = serializedChain.then(() => execute(
      toolCall,
      occurrences[index],
    ));
    serializedChain = run.then(() => undefined, () => undefined);
    return run.then((result) => {
      results[index] = result;
    });
  }));
  return results;
}
