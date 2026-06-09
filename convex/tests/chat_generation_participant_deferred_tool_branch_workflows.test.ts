import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { generateForParticipant } from "../chat/actions_run_generation_participant";
import { createTool, ToolRegistry } from "../tools/registry";

function streamToolCall(toolName: string, callId = "call_1") {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => [
      `data: ${JSON.stringify({
        id: "gen_tools",
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: callId,
              type: "function",
              function: { name: toolName, arguments: "{\"topic\":\"x\"}" },
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

function registryWithDeferred(kind: "spawn_subagents" | "drive_picker", data: unknown) {
  const registry = new ToolRegistry();
  registry.register(createTool({
    name: kind === "spawn_subagents" ? "spawn_subagents" : "drive_picker",
    description: "Deferred workflow test tool",
    parameters: { type: "object", properties: {} },
    execute: async () => ({
      success: true,
      data: { accepted: true },
      deferred: { kind, data },
    }),
  }));
  return registry;
}

function registryWithImmediateTool() {
  const registry = new ToolRegistry();
  registry.register(createTool({
    name: "inspect_context",
    description: "Immediate tool used to exercise continuation handoff.",
    parameters: { type: "object", properties: {} },
    execute: async () => ({
      success: true,
      data: { inspected: true, note: "tool result" },
    }),
  }));
  return registry;
}

function makeCtx() {
  const mutations: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  return {
    mutations,
    scheduled,
    ctx: {
      runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
        if ("jobId" in args) return false;
        if ("userId" in args) return null;
        return null;
      },
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
        if (Array.isArray(args.tasks)) return { runIds: ["run_child_1", "run_child_2"] };
        if (args.userId === "user_1" && args.chatId === "chat_1" && !("messageId" in args)) {
          return [];
        }
        return null;
      },
      scheduler: {
        runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
          scheduled.push(args);
          return "scheduled_1";
        },
      },
      storage: {
        get: async () => null,
        store: async () => "storage_1",
        getUrl: async () => null,
      },
    } as any,
  };
}

async function runParticipant(
  toolRegistry: ToolRegistry,
  overrides: Record<string, unknown> = {},
  argOverrides: Record<string, unknown> = {},
) {
  const state = makeCtx();
  const result = await generateForParticipant({
    ctx: state.ctx,
    args: {
      chatId: "chat_1",
      userId: "user_1",
      userMessageId: "msg_user",
      assistantMessageIds: ["msg_assistant"],
      generationJobIds: ["job_1"],
      expandMultiModelGroups: false,
      webSearchEnabled: false,
      enabledIntegrations: ["drive"],
      turnSkillOverrides: [{ skillId: "skill_1", state: "always" }],
      turnIntegrationOverrides: [{ integrationId: "drive", state: "enabled" }],
      ...argOverrides,
    },
    participant: {
      messageId: "msg_assistant",
      jobId: "job_1",
      modelId: "model_1",
      temperature: 0.2,
      maxTokens: null,
      includeReasoning: null,
      reasoningEffort: null,
      personaId: null,
      systemPrompt: null,
    },
    allMessages: [{ _id: "msg_user", role: "user", content: "Plan the work." }],
    memoryContext: undefined,
    modelCapabilities: new Map([["model_1", {
      provider: "openai",
      supportedParameters: ["tools"],
      hasZdrEndpoint: true,
      contextLength: 128_000,
    } as any]]),
    toolRegistry,
    requestMessagesOverride: [{ role: "user", content: "Plan the work." }],
    isPro: true,
    runtimeProfile: "mobileBasic",
    apiKey: "key",
    actionStartTime: Date.now(),
    progressiveTools: { enabledIntegrations: ["drive"], directToolNames: [], allowSubagents: true },
    ...overrides,
  } as any);
  return { result, mutations: state.mutations, scheduled: state.scheduled };
}

test("generateForParticipant persists deferred subagent batches and schedules each child run", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamToolCall("spawn_subagents", "call_subagents")) as any;

  const { result, mutations, scheduled } = await runParticipant(registryWithDeferred("spawn_subagents", {
    tasks: [
      { title: "Research", prompt: "Find source material." },
      { title: "Draft", prompt: "Write the answer." },
    ],
  }));

  assert.deepEqual(result, {
    deferredForSubagents: true,
    cancelled: false,
    failed: false,
    continued: false,
  });
  const batch = mutations.find((args) => Array.isArray(args.tasks));
  assert.equal(batch?.toolCallId, "call_subagents");
  assert.equal((batch?.tasks as unknown[]).length, 2);
  assert.equal((batch?.paramsSnapshot as any).enabledIntegrations[0], "drive");
  assert.deepEqual(scheduled, [{ runId: "run_child_1" }, { runId: "run_child_2" }]);
});

test("generateForParticipant snapshots materialized web search intent for deferred subagents", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamToolCall("spawn_subagents", "call_subagents")) as any;

  const { mutations } = await runParticipant(
    registryWithDeferred("spawn_subagents", {
      tasks: [{ title: "Research", prompt: "Find source material." }],
    }),
    { requireZdrOverride: true },
    { webSearchEnabled: true },
  );

  const batch = mutations.find((args) => Array.isArray(args.tasks));
  const snapshot = batch?.paramsSnapshot as {
    webSearchToolEnabled?: boolean;
    requireZdr?: boolean;
    requestParams?: { webSearchEnabled?: boolean; provider?: Record<string, unknown> };
  };
  assert.equal(snapshot.webSearchToolEnabled, true);
  assert.equal(snapshot.requireZdr, true);
  assert.equal(snapshot.requestParams?.webSearchEnabled, false);
  assert.deepEqual(snapshot.requestParams?.provider, { zdr: true });
});

test("generateForParticipant fails deferred subagent pauses that contain no runnable tasks", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamToolCall("spawn_subagents", "call_empty")) as any;

  const { result, mutations } = await runParticipant(registryWithDeferred("spawn_subagents", {
    tasks: [],
  }));

  assert.equal(result.failed, true);
  const finalize = mutations.find((args) => args.status === "failed");
  assert.match(String(finalize?.content), /Subagent tool paused without valid tasks/);
});

test("generateForParticipant stores deferred Drive picker batches without creating subagent runs", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamToolCall("drive_picker", "call_drive")) as any;

  const { result, mutations, scheduled } = await runParticipant(registryWithDeferred("drive_picker", {
    prompt: "Choose the source deck",
  }));

  assert.equal(result.deferredForSubagents, true);
  const driveBatch = mutations.find((args) => args.toolCallId === "call_drive");
  assert.equal(driveBatch?.parentMessageId, "msg_assistant");
  assert.equal((driveBatch?.paramsSnapshot as any).turnIntegrationOverrides[0].integrationId, "drive");
  assert.deepEqual(scheduled, []);
});

test("generateForParticipant hands off after a completed tool round when invocation budget is exhausted", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamToolCall("inspect_context", "call_inspect")) as any;

  const handoffs: Array<Record<string, unknown>> = [];
  const { result, mutations, scheduled } = await runParticipant(registryWithImmediateTool(), {
    continuationHandoff: {
      continuationCount: 0,
      maxToolRoundsPerInvocation: 1,
      onHandoff: async (handoff: Record<string, unknown>) => {
        handoffs.push(handoff);
      },
    },
  });

  assert.deepEqual(result, {
    deferredForSubagents: false,
    cancelled: false,
    failed: false,
    continued: true,
  });
  assert.equal(handoffs.length, 1);
  assert.equal((handoffs[0]?.participant as any)?.jobId, "job_1");
  assert.equal(((handoffs[0]?.toolCalls as unknown[])?.[0] as any)?.name, "inspect_context");
  assert.match(String(((handoffs[0]?.toolResults as unknown[])?.[0] as any)?.result), /inspected/);
  assert.equal(handoffs[0]?.continuationCount, 1);
  assert.equal(mutations.some((args) => args.status === "completed"), false);
  assert.deepEqual(scheduled, []);
});
