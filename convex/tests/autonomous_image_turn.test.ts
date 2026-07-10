import assert from "node:assert/strict";
import test from "node:test";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";
import {
  createRunParticipantTurnDepsForTest,
  runParticipantTurn,
} from "../autonomous/actions_run_cycle_turn";
import { GenerationCancelledError } from "../chat/generation_helpers";
import {
  autonomousImagePromptText,
  buildAutonomousTranscriptMessages,
} from "../autonomous/actions_run_cycle_transcript";

function createContext() {
  const mutations: Array<Record<string, unknown>> = [];
  let creates = 0;
  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("chatId" in args) {
        return [{ _id: "user_message_1", role: "user", content: "Draw a cat" }];
      }
      if ("jobId" in args) return false;
      return {};
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      creates += 1;
      if (creates === 1) return "assistant_message_1";
      if (creates === 2) return "job_1";
      return undefined;
    },
    scheduler: {
      runAfter: async () => "scheduled_1",
    },
  });
  return { ctx, mutations };
}

function imageTurnParams(ctx: ReturnType<typeof createMockCtx>) {
  return {
    ctx,
    sessionId: "session_1" as never,
    chatId: "chat_1" as never,
    participant: {
      participantId: "participant_1",
      modelId: "openai/gpt-image-2",
      displayName: "Image participant",
    },
    cycleParentIds: ["user_message_1" as never],
    modelCapabilities: new Map([[
      "openai/gpt-image-2",
      {
        hasImageGeneration: true,
        imageCapabilities: { maxInputReferences: 16 },
      },
    ]]),
    memoryContext: undefined,
    userId: "user_1",
    webSearchEnabled: false,
  };
}

function baseDeps() {
  return createRunParticipantTurnDepsForTest({
    getRequiredUserOpenRouterApiKey: async () => "test-key",
    loadMemoryContext: async () => undefined,
    buildRequestMessages: () => [{ role: "user", content: "Draw a cat" }],
    promoteLatestUserVideoUrls: (messages) => ({ messages, events: [] }),
    gateParameters: () => ({ modalities: ["image"] }),
    createStreamWriter: () => ({
      totalReasoning: "",
      hasSeenContentDelta: false,
    }) as never,
  });
}

test("autonomous image turns use the shared dedicated dispatcher", async () => {
  const { ctx } = createContext();
  const dispatches: Array<Record<string, unknown>> = [];
  let streamed = false;
  const deps = createRunParticipantTurnDepsForTest({
    ...baseDeps(),
    runAutonomousImageTurn: async (args) => {
      dispatches.push(args as unknown as Record<string, unknown>);
    },
    callOpenRouterStreaming: async () => {
      streamed = true;
      throw new Error("chat transport should not run");
    },
  });

  const result = await runParticipantTurn(imageTurnParams(ctx), deps);

  assert.deepEqual(result, {
    kind: "completed",
    messageId: "assistant_message_1",
  });
  assert.equal(streamed, false);
  assert.equal(dispatches[0]?.modelId, "openai/gpt-image-2");
  assert.equal(dispatches[0]?.maxInputReferences, 16);
  assert.match(String(dispatches[0]?.prompt), /Draw a cat/);
});

test("autonomous image cancellation remains cancelled", async () => {
  const { ctx, mutations } = createContext();
  const deps = createRunParticipantTurnDepsForTest({
    ...baseDeps(),
    runAutonomousImageTurn: async () => {
      throw new GenerationCancelledError();
    },
  });

  const result = await runParticipantTurn(imageTurnParams(ctx), deps);

  assert.deepEqual(result, { kind: "cancelled" });
  assert.ok(mutations.some((entry) =>
    entry.jobId === "job_1" && entry.status === "cancelled"
  ));
  assert.ok(mutations.some((entry) =>
    entry.messageId === "assistant_message_1" && entry.status === "cancelled"
  ));
});

test("autonomous image prompts retain visual parts without synthetic text labels", () => {
  const transcript = buildAutonomousTranscriptMessages([
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "[Generated image context for the next response]",
        },
        {
          type: "image_url",
          image_url: { url: "https://files.example/concept.png" },
        },
      ],
    },
    { role: "assistant", name: "Critic", content: "Increase the contrast." },
  ], "the next participant");

  const content = transcript.at(-1)?.content;
  assert.ok(Array.isArray(content));
  assert.deepEqual(content.at(-1), {
    type: "image_url",
    image_url: { url: "https://files.example/concept.png" },
  });
  const prompt = autonomousImagePromptText(content);
  assert.match(prompt, /Increase the contrast/);
  assert.doesNotMatch(prompt, /Generated image context|\[image_url\]|files\.example/);
});
