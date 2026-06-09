import assert from "node:assert/strict";
import test from "node:test";

import { runGenerationParticipantRuntimeHandler } from "../chat/actions_run_generation_participant_runtime";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

function staleResumeArgs(overrides: Record<string, unknown> = {}) {
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
    resumeExpected: true,
    ...overrides,
  };
}

test("resume routing uses checkpoint direct tools before stale action args", async () => {
  const delegatedArgs: Array<Record<string, unknown>> = [];
  const mutationCalls: Array<Record<string, unknown>> = [];

  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("jobId" in args && Object.keys(args).length === 1) {
        return {
          activeProfiles: [],
          groupSnapshot: {
            directToolNames: ["workspace_exec"],
          },
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
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      return null;
    },
  });

  await runGenerationParticipantRuntimeHandler(ctx, staleResumeArgs());

  assert.equal(delegatedArgs.length, 1);
  assert.deepEqual(delegatedArgs[0]?.directToolNames, []);
  assert.equal((delegatedArgs[0]?.participant as Record<string, unknown>)?.jobId, "job_1");
  assert.equal(mutationCalls.length, 0);
});
