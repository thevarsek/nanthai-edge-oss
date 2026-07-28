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

function registryWithDeferred(
  kind: "spawn_subagents" | "drive_picker" | "presentation_workflow",
  data: unknown,
) {
  const registry = new ToolRegistry();
  registry.register(createTool({
    name: kind === "spawn_subagents"
      ? "spawn_subagents"
      : kind === "drive_picker"
        ? "drive_picker"
        : "create_presentation",
    description: "Deferred workflow test tool",
    parameters: { type: "object", properties: {} },
    effectPolicy: { effect: "write", retry: "idempotency_key_required" },
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
    effectPolicy: { effect: "read", retry: "safe" },
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
        if (typeof args.captureKey === "string" && !("artifacts" in args)) {
          return { decision: "execute", artifactIds: [] };
        }
        if (typeof args.captureKey === "string" && Array.isArray(args.artifacts)) {
          return { inserted: true, stale: false, artifactIds: [] };
        }
        if (typeof args.operationKey === "string" && typeof args.toolName === "string") {
          return "status" in args ? true : { decision: "execute", artifactIds: [] };
        }
        if (Array.isArray(args.tasks)) {
          return { batchId: "batch_1", runIds: ["run_child_1", "run_child_2"] };
        }
        if (args.parentJobId === "job_1" && args.toolCallId === "call_drive") {
          return { batchId: "drive_batch_1" };
        }
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

test("generateForParticipant persists deferred subagent batches and starts each child Workflow", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamToolCall("spawn_subagents", "call_subagents")) as any;

  const { result, mutations, scheduled } = await runParticipant(registryWithDeferred("spawn_subagents", {
    tasks: [
      { title: "Research", prompt: "Find source material." },
      { title: "Draft", prompt: "Write the answer." },
    ],
  }));

  assert.deepEqual({
    deferredForSubagents: result.deferredForSubagents,
    cancelled: result.cancelled,
    failed: result.failed,
    continued: result.continued,
    usage: result.usage,
    generationId: result.generationId,
  }, {
    deferredForSubagents: true,
    cancelled: false,
    failed: false,
    continued: false,
    usage: null,
    generationId: "gen_tools",
  });
  assert.equal(result.latencies?.tool_call_count, 1);
  assert.equal(result.latencies?.tool_round_count, 1);
  const batch = mutations.find((args) => Array.isArray(args.tasks));
  assert.equal(batch?.toolCallId, "call_subagents");
  assert.equal((batch?.tasks as unknown[]).length, 2);
  assert.equal((batch?.paramsSnapshot as any).enabledIntegrations[0], "drive");
  assert.deepEqual(
    mutations.filter((args) => typeof args.runId === "string"),
    [{ runId: "run_child_1" }, { runId: "run_child_2" }],
  );
  assert.deepEqual(
    scheduled.filter((payload) => payload.event !== "assistant_response_first_patch"),
    [],
  );
});

test("Workflow subagent handoff commits a deferred parent checkpoint before child enqueue", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () =>
    streamToolCall("spawn_subagents", "call_subagents")) as any;
  const handoffs: Array<Record<string, any>> = [];

  const { result, mutations } = await runParticipant(
    registryWithDeferred("spawn_subagents", {
      tasks: [{ title: "Research", prompt: "Find source material." }],
    }),
    {
      continuationHandoff: {
        continuationCount: 0,
        maxToolRoundsPerInvocation: 1,
        onHandoff: async (checkpoint: Record<string, any>) => {
          handoffs.push(checkpoint);
        },
      },
    },
    {
      workflowResumeEventId: "event_1",
      executionAttemptId: "attempt_1",
      executionFence: 7,
    },
  );

  assert.equal(result.failed, false);
  assert.equal(handoffs.length, 0);
  const batch = mutations.find((args) => Array.isArray(args.tasks));
  assert.equal((batch?.paramsSnapshot as { roundKey?: string }).roundKey, "event_1");
  assert.equal((batch?.checkpoint as { roundKey?: string }).roundKey, "event_1");
  assert.equal(
    (batch?.checkpoint as { group?: { executionFence?: number } }).group?.executionFence,
    7,
  );
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
  assert.deepEqual(
    scheduled.filter((payload) => payload.event !== "assistant_response_first_patch"),
    [],
  );
});

test("Workflow Drive picker handoff checkpoints ownership before waiting for selection", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () =>
    streamToolCall("drive_picker", "call_drive")) as any;
  const handoffs: Array<Record<string, unknown>> = [];

  const { result, mutations } = await runParticipant(
    registryWithDeferred("drive_picker", { prompt: "Choose the source deck" }),
    {
      continuationHandoff: {
        continuationCount: 4,
        maxToolRoundsPerInvocation: 1,
        onHandoff: async (checkpoint: Record<string, unknown>) => {
          handoffs.push(checkpoint);
        },
      },
    },
    {
      workflowResumeEventId: "event_drive",
      executionAttemptId: "attempt_1",
      executionFence: 7,
    },
  );

  assert.equal(result.failed, false);
  assert.equal(handoffs.length, 0);
  const durableBatch = mutations.find((args) => "checkpoint" in args);
  assert.equal((durableBatch?.checkpoint as { roundKey?: string }).roundKey, "event_drive");
});

test("generateForParticipant hands deferred presentations to a durable workflow checkpoint", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () =>
    streamToolCall("create_presentation", "call_presentation")) as any;

  const handoffs: Array<{ checkpoint: Record<string, any>; workflow: Record<string, unknown> }> = [];
  const { result, mutations } = await runParticipant(
    registryWithDeferred("presentation_workflow", { projectId: "project_1" }),
    {
      continuationHandoff: {
        continuationCount: 2,
        maxToolRoundsPerInvocation: 1,
        onHandoff: async () => undefined,
        onDeferredPresentation: async (
          checkpoint: Record<string, any>,
          workflow: Record<string, unknown>,
        ) => {
          handoffs.push({ checkpoint, workflow });
        },
      },
    },
  );

  assert.equal(result.continued, true);
  assert.equal(result.deferredForSubagents, false);
  assert.equal(handoffs.length, 1);
  assert.deepEqual(handoffs[0]?.workflow, {
    projectId: "project_1",
    toolCallId: "call_presentation",
  });
  assert.equal(handoffs[0]?.checkpoint.continuationCount, 3);
  assert.equal(handoffs[0]?.checkpoint.messages.at(-1)?.tool_call_id, "call_presentation");
  assert.equal(mutations.some((args) => args.status === "completed"), false);
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

  assert.deepEqual({
    deferredForSubagents: result.deferredForSubagents,
    cancelled: result.cancelled,
    failed: result.failed,
    continued: result.continued,
    usage: result.usage,
    generationId: result.generationId,
  }, {
    deferredForSubagents: false,
    cancelled: false,
    failed: false,
    continued: true,
    usage: null,
    generationId: "gen_tools",
  });
  assert.equal(result.latencies?.tool_call_count, 1);
  assert.equal(result.latencies?.tool_round_count, 1);
  assert.equal(handoffs.length, 1);
  assert.equal((handoffs[0]?.participant as any)?.jobId, "job_1");
  assert.equal(((handoffs[0]?.toolCalls as unknown[])?.[0] as any)?.name, "inspect_context");
  assert.match(String(((handoffs[0]?.toolResults as unknown[])?.[0] as any)?.result), /inspected/);
  assert.equal(handoffs[0]?.continuationCount, 1);
  assert.equal(mutations.some((args) => args.status === "completed"), false);
  assert.deepEqual(
    scheduled.filter((payload) => payload.event !== "assistant_response_first_patch"),
    [],
  );
});

test("generateForParticipant keeps prior continuation tools in the live projection", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamToolCall("inspect_context", "call_current")) as any;

  const { mutations } = await runParticipant(registryWithImmediateTool(), {
    initialToolCalls: [{
      id: "call_prior",
      name: "load_skill",
      arguments: '{"name":"pptx"}',
    }],
    initialToolResults: [{
      toolCallId: "call_prior",
      toolName: "load_skill",
      result: '{"loaded":true}',
    }],
    continuationHandoff: {
      continuationCount: 1,
      maxToolRoundsPerInvocation: 1,
      onHandoff: async () => undefined,
    },
  });

  const liveToolUpdates = mutations.filter((args) => Array.isArray(args.toolCalls));
  assert.ok(liveToolUpdates.some((args) => {
    const calls = args.toolCalls as Array<{ id: string }>;
    return calls.map((call) => call.id).join(",") === "call_prior,call_current";
  }));
});

test("generateForParticipant hands restored presentation profiles from V8 to Node before model use", async (t) => {
  t.after(() => mock.restoreAll());
  let fetchCalls = 0;
  mock.method(globalThis, "fetch", async () => {
    fetchCalls += 1;
    return streamToolCall("create_presentation", "should_not_run");
  }) as any;

  const handoffs: Array<Record<string, unknown>> = [];
  const { result } = await runParticipant(registryWithImmediateTool(), {
    restoredActiveProfiles: ["presentations"],
    restoredLoadedSkills: [{
      skill: "pptx",
      name: "Presentations",
      runtimeMode: "node",
      instructions: "Use presentation tools directly.",
      requiredToolProfiles: ["presentations"],
      requiredToolIds: ["create_presentation"],
      requiredIntegrationIds: [],
      requiredCapabilities: [],
    }],
    v8RuntimeHandoffGuards: true,
    continuationHandoff: {
      continuationCount: 0,
      maxToolRoundsPerInvocation: 1,
      onHandoff: async (handoff: Record<string, unknown>) => {
        handoffs.push(handoff);
      },
    },
  });

  assert.equal(fetchCalls, 0);
  assert.equal(result.continued, true);
  assert.equal(handoffs.length, 1);
  assert.deepEqual(handoffs[0]?.activeProfiles, ["presentations"]);
  assert.equal((handoffs[0]?.loadedSkills as Array<{ skill: string }>)[0]?.skill, "pptx");
});
