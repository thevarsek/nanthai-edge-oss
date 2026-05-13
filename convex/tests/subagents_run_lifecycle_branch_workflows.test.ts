import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { runSubagentRunHandler } from "../subagents/actions_run_subagent";

function sseToolCall(toolName: string, args: Record<string, unknown>, callId = "tool_call_1") {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => [
      `data: ${JSON.stringify({
        id: "gen_tool",
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: callId,
              type: "function",
              function: {
                name: toolName,
                arguments: JSON.stringify(args),
              },
            }],
          },
          finish_reason: "tool_calls",
        }],
      })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
  } as any;
}

function sseText(content: string) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => [
      `data: ${JSON.stringify({
        id: "gen_final",
        choices: [{ delta: { content } }],
      })}`,
      `data: ${JSON.stringify({ choices: [{ finish_reason: "stop" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
  } as any;
}

test("runSubagentRunHandler records tool rounds from snapshots and resumes the parent when terminal", async (t) => {
  t.after(() => mock.restoreAll());
  const responses = [
    sseToolCall("load_skill", { name: "docx" }, "call_load_skill"),
    sseText("Child answer after loading the skill."),
  ];
  mock.method(globalThis, "fetch", async () => {
    const response = responses.shift();
    assert.ok(response, "unexpected extra OpenRouter fetch");
    return response;
  }) as any;

  const runMutationCalls: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  let userScopedQueryCount = 0;
  const run = {
    _id: "run_1",
    batchId: "batch_1",
    status: "waiting_continuation",
    title: "Summarize",
    taskPrompt: "Use the document skill.",
    content: "Partial ",
    reasoning: "Thinking ",
    continuationCount: 1,
    conversationSnapshot: {
      messages: [{ role: "user", content: "Continue the subagent task." }],
      totalUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      allToolCalls: [{ id: "previous_call", name: "previous_tool", arguments: "{}" }],
      allToolResults: [{ toolCallId: "previous_call", toolName: "previous_tool", result: "{\"ok\":true}" }],
      loadedSkills: [{ skill: "existing", name: "Existing", instructions: "Existing instructions" }],
      compactionCount: 1,
    },
  };
  const batch = {
    _id: "batch_1",
    status: "running_children",
    userId: "user_1",
    chatId: "chat_1",
    parentMessageId: "parent_msg_1",
    childConversationSeed: [{ role: "assistant", content: "Seed should not be used when snapshot exists." }],
    paramsSnapshot: { enabledIntegrations: [], requestParams: {} },
    participantSnapshot: {
      userId: "user_1",
      chatId: "chat_1",
      participant: { modelId: "openai/gpt-5" },
    },
  };

  const ctx = {
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      runMutationCalls.push(args);
      if ("expectedStatuses" in args) return true;
      if (args.runId === "run_1" && args.status === "completed") {
        return { batchId: "batch_1", allTerminal: true };
      }
      if (args.batchId === "batch_1" && args.status === "waiting_to_resume") {
        return true;
      }
      return null;
    },
    runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("runId" in args) return run;
      if ("batchId" in args) return batch;
      if ("modelId" in args) {
        return {
          supportedParameters: ["tools"],
          hasImageGeneration: false,
          hasReasoning: true,
          contextLength: 128_000,
        };
      }
      if ("slug" in args) {
        assert.equal(args.slug, "docx");
        return {
          slug: "docx",
          name: "DOCX",
          runtimeMode: "standard",
          requiredToolIds: ["read_docx"],
          requiredToolProfiles: ["docs"],
          requiredIntegrationIds: [],
          requiredCapabilities: [],
          instructionsRaw: "Read and write DOCX files carefully.",
        };
      }
      if ("userId" in args) {
        userScopedQueryCount += 1;
        return userScopedQueryCount === 1
          ? "sk-test"
          : { isPro: true };
      }
      return null;
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "scheduled_1";
      },
    },
  } as any;

  await runSubagentRunHandler(ctx, { runId: "run_1" as any });

  assert.ok(runMutationCalls.some((call) =>
    call.runId === "run_1"
      && call.status === "streaming"
      && (call.toolCalls as Array<{ name?: string }> | undefined)?.some((toolCall) =>
        toolCall.name === "load_skill"
      )
  ));
  assert.ok(runMutationCalls.some((call) =>
    call.runId === "run_1"
      && Array.isArray(call.toolResults)
      && String(((call.toolResults as unknown[])?.at(-1) as any)?.result).includes("Read and write DOCX")
  ));
  const finalize = runMutationCalls.find((call) => call.runId === "run_1" && call.status === "completed");
  assert.ok(finalize);
  assert.equal(finalize.content, "Partial Child answer after loading the skill.");
  assert.equal(((finalize.toolCalls as unknown[])?.[0] as any)?.name, "previous_tool");
  assert.equal(((finalize.toolCalls as unknown[])?.at(-1) as any)?.name, "load_skill");
  assert.ok(runMutationCalls.some((call) =>
    call.batchId === "batch_1" && call.status === "waiting_to_resume"
  ));
  assert.ok(scheduled.some((entry) => entry.runId === "run_1"));
  assert.ok(scheduled.some((entry) => entry.batchId === "batch_1"));
  assert.equal(responses.length, 0);
});
