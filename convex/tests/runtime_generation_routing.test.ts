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
