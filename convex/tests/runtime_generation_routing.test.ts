import assert from "node:assert/strict";
import test from "node:test";

import { runGenerationParticipantRuntimeHandler } from "../chat/actions_run_generation_participant_runtime";
import {
  mapBatchTerminalStatus,
  requiresNodeWorker,
} from "../chat/actions_run_generation_participant_runtime";
import { buildRuntimeBaseToolRegistry } from "../tools/progressive_registry_runtime";
import {
  classifyProfileRuntimeSafety,
  classifyToolRuntimeSafety,
} from "../tools/runtime_safety";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

function baseRuntimeArgs(overrides: Record<string, unknown> = {}) {
  return {
    chatId: "chat_1" as any,
    userMessageId: "msg_user" as any,
    assistantMessageIds: ["msg_assistant" as any],
    generationJobIds: ["job_1" as any],
    participant: {
      modelId: "openai/gpt-5",
      messageId: "msg_assistant" as any,
      jobId: "job_1" as any,
    } as any,
    userId: "user_1",
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    effectiveIntegrations: [],
    directToolNames: [],
    isPro: true,
    allowSubagents: false,
    resumeExpected: false,
    ...overrides,
  };
}

test("buildRuntimeBaseToolRegistry exposes only the always-on runtime-safe base tools", () => {
  const registry = buildRuntimeBaseToolRegistry({ isPro: true });

  assert.ok(registry.get("fetch_image"));
  assert.ok(registry.get("search_chats"));
  assert.ok(registry.get("load_skill"));
  assert.ok(registry.get("list_skills"));
  assert.equal(registry.get("workspace_exec"), undefined);
  assert.equal(registry.get("generate_docx"), undefined);
});

test("runtime safety classification stays conservative", () => {
  assert.equal(classifyToolRuntimeSafety("load_skill"), "runtime-safe");
  assert.equal(classifyToolRuntimeSafety("workspace_exec"), "node-required");
  assert.equal(classifyProfileRuntimeSafety("docs"), "node-required");
  assert.equal(classifyProfileRuntimeSafety("workspace"), "node-required");
});

test("mapBatchTerminalStatus maps all status combinations correctly", () => {
  assert.equal(mapBatchTerminalStatus("cancelled", "streaming"), "cancelled");
  assert.equal(mapBatchTerminalStatus("streaming", "cancelled"), "cancelled");
  assert.equal(mapBatchTerminalStatus("failed", "streaming"), "failed");
  assert.equal(mapBatchTerminalStatus("streaming", "failed"), "failed");
  assert.equal(mapBatchTerminalStatus("streaming", "timedOut"), "failed");
  assert.equal(mapBatchTerminalStatus("completed", "completed"), "completed");
  assert.equal(mapBatchTerminalStatus(undefined, undefined), "completed");
  assert.equal(mapBatchTerminalStatus("streaming", "streaming"), "completed");
});

test("requiresNodeWorker returns true for video, audio, node tools, or node profiles", () => {
  assert.equal(requiresNodeWorker({
    directToolNames: [], activeProfiles: [], hasVideoGeneration: true, hasAudioOutput: false,
  }), true);
  assert.equal(requiresNodeWorker({
    directToolNames: [], activeProfiles: [], hasVideoGeneration: false, hasAudioOutput: true,
  }), true);
  assert.equal(requiresNodeWorker({
    directToolNames: ["workspace_exec"], activeProfiles: [], hasVideoGeneration: false, hasAudioOutput: false,
  }), true);
  assert.equal(requiresNodeWorker({
    directToolNames: ["list_documents", "read_document", "find_in_document"], activeProfiles: [], hasVideoGeneration: false, hasAudioOutput: false,
  }), true);
  assert.equal(requiresNodeWorker({
    directToolNames: [], activeProfiles: ["docs"], hasVideoGeneration: false, hasAudioOutput: false,
  }), true);
  assert.equal(requiresNodeWorker({
    directToolNames: [], activeProfiles: [], hasVideoGeneration: false, hasAudioOutput: false,
  }), false);
  assert.equal(requiresNodeWorker({
    directToolNames: ["fetch_image", "search_chats"], activeProfiles: [], hasVideoGeneration: false, hasAudioOutput: false,
  }), false);
});

test("runGenerationParticipantRuntimeHandler delegates to Node when continuation has node-required profiles", async () => {
  const delegatedArgs: Array<Record<string, unknown>> = [];

  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("jobId" in args && Object.keys(args).length === 1) {
        return {
          activeProfiles: ["docs"],
        };
      }
      if ("modelId" in args) {
        return {
          hasVideoGeneration: false,
          hasAudioOutput: false,
        };
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runAction: async (_ref: unknown, args: Record<string, unknown>) => {
      delegatedArgs.push(args);
      return undefined;
    },
  });

  await runGenerationParticipantRuntimeHandler(ctx, {
    chatId: "chat_1" as any,
    userMessageId: "msg_user" as any,
    assistantMessageIds: ["msg_assistant" as any],
    generationJobIds: ["job_1" as any],
    participant: {
      modelId: "openai/gpt-5",
      messageId: "msg_assistant" as any,
      jobId: "job_1" as any,
    } as any,
    userId: "user_1",
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    effectiveIntegrations: [],
    directToolNames: [],
    isPro: true,
    allowSubagents: false,
    resumeExpected: true,
  });

  assert.equal(delegatedArgs.length, 1);
  assert.equal(delegatedArgs[0]?.userId, "user_1");
  assert.equal((delegatedArgs[0]?.participant as Record<string, unknown>)?.jobId, "job_1");
});

test("runGenerationParticipantRuntimeHandler delegates direct node-required runtime work", async () => {
  const delegatedArgs: Array<Record<string, unknown>> = [];
  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("modelId" in args) {
        return {
          hasVideoGeneration: true,
          hasAudioOutput: false,
        };
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runAction: async (_ref: unknown, args: Record<string, unknown>) => {
      delegatedArgs.push(args);
    },
  });

  await runGenerationParticipantRuntimeHandler(
    ctx,
    baseRuntimeArgs({ directToolNames: ["workspace_exec"], enqueuedAt: Date.now() - 5 }),
  );

  assert.equal(delegatedArgs.length, 1);
});

test("runGenerationParticipantRuntimeHandler exits when expected continuation cannot be claimed", async () => {
  const mutationCalls: Array<Record<string, unknown>> = [];
  let jobQueryCount = 0;
  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("jobId" in args && Object.keys(args).length === 1) {
        jobQueryCount += 1;
        return null;
      }
      if ("modelId" in args) {
        return {
          hasVideoGeneration: false,
          hasAudioOutput: false,
        };
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      return null;
    },
  });

  await runGenerationParticipantRuntimeHandler(
    ctx,
    baseRuntimeArgs({ resumeExpected: true }),
  );

  assert.equal(jobQueryCount, 1);
  assert.deepEqual(mutationCalls, [{ jobId: "job_1" }]);
});

test("runGenerationParticipantRuntimeHandler clears continuations for missing and terminal jobs", async () => {
  for (const job of [null, { status: "completed" }, { status: "timedOut" }]) {
    const scheduled: Array<Record<string, unknown>> = [];
    const ctx = createMockCtx({
      runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
        if ("modelId" in args) {
          return {
            hasVideoGeneration: false,
            hasAudioOutput: false,
          };
        }
        if ("jobId" in args) {
          return job;
        }
        throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
      },
      scheduler: {
        runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
          scheduled.push(args);
          return "sched_1";
        },
        runAt: async () => "unused",
      },
    });

    await runGenerationParticipantRuntimeHandler(ctx, baseRuntimeArgs());

    assert.deepEqual(scheduled, [{ jobId: "job_1" }]);
  }
});

test("runGenerationParticipantRuntimeHandler finalizes setup failures and related batches", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const jobStatuses = ["queued", "streaming", "failed", "failed"];
  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("modelId" in args) {
        return {
          hasVideoGeneration: false,
          hasAudioOutput: false,
          supportedParameters: [],
          contextLength: 1024,
        };
      }
      if ("jobId" in args) {
        return { status: jobStatuses.shift() ?? "failed" };
      }
      if ("messageId" in args) {
        return { status: "failed" };
      }
      if ("userId" in args) {
        return null;
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "sched_1";
      },
      runAt: async () => "unused",
    },
  });

  await assert.rejects(
    runGenerationParticipantRuntimeHandler(
      ctx,
      baseRuntimeArgs({
        subagentBatchId: "batch_1" as any,
        drivePickerBatchId: "drive_batch_1" as any,
        searchSessionId: "search_1" as any,
      }),
    ),
    /OpenRouter API key/,
  );

  assert.ok(scheduled.some((args) => args.jobId === "job_1"));
  assert.ok(mutations.some((args) =>
    args.messageId === "msg_assistant"
    && args.jobId === "job_1"
    && args.status === "failed"
  ));
  assert.ok(mutations.some((args) =>
    args.batchId === "batch_1"
    && args.expectedCurrentStatus === "resuming"
    && args.status === "failed"
  ));
  assert.ok(mutations.some((args) =>
    args.batchId === "drive_batch_1"
    && args.status === "failed"
  ));
  assert.ok(mutations.some((args) =>
    args.sessionId === "search_1"
    && (args.patch as any)?.status === "failed"
  ));
});
