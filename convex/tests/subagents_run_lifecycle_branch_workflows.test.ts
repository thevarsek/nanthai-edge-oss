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

test("runSubagentRunHandler checkpoints one tool round and completes on the next Workflow step", async (t) => {
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
      if ("captureKey" in args && !("artifacts" in args)) {
        return { decision: "execute", artifactIds: [] };
      }
      if (Array.isArray(args.artifacts)) {
        return { inserted: true, stale: false, artifactIds: ["artifact_1"] };
      }
      if ("inputHash" in args) return { decision: "execute" as const };
      if ("expectedStatuses" in args) {
        run.status = "streaming";
        return true;
      }
      if (args.runId === "run_1" && "conversationSnapshot" in args) {
        Object.assign(run, {
          status: "waiting_continuation",
          content: args.content,
          reasoning: args.reasoning,
          continuationCount: args.continuationCount,
          conversationSnapshot: args.conversationSnapshot,
        });
        return { batchId: "batch_1" };
      }
      if (args.runId === "run_1" && args.status === "completed") {
        run.status = "completed";
        return { batchId: "batch_1", allTerminal: true };
      }
      if (args.batchId === "batch_1" && args.status === "waiting_to_resume") {
        return true;
      }
      return null;
    },
    runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("executionAttemptId" in args) return true;
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
        return userScopedQueryCount % 2 === 1
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

  await runSubagentRunHandler(ctx, {
    runId: "run_1" as any,
    workflowManaged: true,
    executionAttemptId: "attempt_1" as any,
    executionFence: 7,
  });

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
  assert.equal(
    runMutationCalls.some((call) => call.runId === "run_1" && call.status === "completed"),
    false,
  );
  assert.equal(responses.length, 1);

  await runSubagentRunHandler(ctx, {
    runId: "run_1" as any,
    workflowManaged: true,
    executionAttemptId: "attempt_1" as any,
    executionFence: 7,
  });

  const finalize = runMutationCalls.find((call) => call.runId === "run_1" && call.status === "completed");
  assert.ok(finalize);
  assert.equal(finalize.content, "Partial Child answer after loading the skill.");
  assert.equal(((finalize.toolCalls as unknown[])?.[0] as any)?.name, "previous_tool");
  assert.equal(((finalize.toolCalls as unknown[])?.at(-1) as any)?.name, "load_skill");
  assert.ok(runMutationCalls.some((call) =>
    call.batchId === "batch_1" && call.status === "waiting_to_resume"
  ));
  assert.equal(scheduled.some((entry) => entry.runId === "run_1"), false);
  assert.equal(scheduled.some((entry) => entry.batchId === "batch_1"), false);
  assert.equal(responses.length, 0);
});

test("runSubagentRunHandler rebuilds materialized web_search from snapshot intent", async (t) => {
  t.after(() => mock.restoreAll());
  let requestBody: Record<string, unknown> = {};
  mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return sseText("Child answer with optional web search available.");
  }) as any;

  const run = {
    _id: "run_1",
    batchId: "batch_1",
    status: "queued",
    title: "Research",
    taskPrompt: "Use current information if needed.",
    continuationCount: 0,
  };
  const batch = {
    _id: "batch_1",
    status: "running_children",
    userId: "user_1",
    chatId: "chat_1",
    parentMessageId: "parent_msg_1",
    parentJobId: "parent_job_1",
    toolCallId: "call_spawn",
    sourceUserMessageId: "msg_user",
    childConversationSeed: [{ role: "user", content: "Seed prompt." }],
    paramsSnapshot: {
      enabledIntegrations: [],
      webSearchToolEnabled: true,
      requireZdr: true,
      requestParams: {
        webSearchEnabled: false,
        provider: { zdr: true },
      },
    },
    participantSnapshot: {
      userId: "user_1",
      chatId: "chat_1",
      participant: { modelId: "openai/gpt-5" },
    },
  };

  let userScopedQueryCount = 0;
  const ctx = {
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("expectedStatuses" in args) return true;
      if (args.runId === "run_1" && args.status === "completed") {
        return { batchId: "batch_1", allTerminal: false };
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
          hasZdrEndpoint: true,
          contextLength: 128_000,
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
      runAfter: async () => "scheduled_1",
    },
  } as any;

  await runSubagentRunHandler(ctx, { runId: "run_1" as any });

  const toolNames = (requestBody.tools as Array<{ function?: { name?: string } }> | undefined)
    ?.map((tool) => tool.function?.name);
  assert.ok(toolNames?.includes("web_search"));
  assert.equal("plugins" in requestBody, false);
  assert.deepEqual(requestBody.provider, { sort: "latency", zdr: true });
});
