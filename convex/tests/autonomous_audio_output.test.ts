import assert from "node:assert/strict";
import test from "node:test";

import type { Id } from "../_generated/dataModel";
import type { ChatRequestParameters } from "../lib/openrouter";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";
import {
  createRunParticipantTurnDepsForTest,
  runParticipantTurn,
} from "../autonomous/actions_run_cycle_turn";

interface AudioTurnResult {
  blobs: Blob[];
  mutations: Array<Record<string, unknown>>;
  requestParams: ChatRequestParameters[];
  outcome: Awaited<ReturnType<typeof runParticipantTurn>>;
}

async function executeAudioTurn(args: {
  audioBase64: string;
  content: string;
  transcript: string;
}): Promise<AudioTurnResult> {
  const blobs: Blob[] = [];
  const mutations: Array<Record<string, unknown>> = [];
  const requestParams: ChatRequestParameters[] = [];
  const messageId = "message_audio" as Id<"messages">;
  const jobId = "job_audio" as Id<"generationJobs">;

  const ctx = createMockCtx({
    runQuery: async (_ref: unknown, input: Record<string, unknown>) => {
      if (input.chatId) {
        return [{ _id: "message_user", role: "user", content: "Create a short song" }];
      }
      if (input.jobId) return false;
      if (input.userId) return { preferredVoice: "alloy" };
      return null;
    },
    runMutation: async (_ref: unknown, input: Record<string, unknown>) => {
      mutations.push(input);
      if (input.parentMessageIds) return messageId;
      if (input.messageId === messageId && input.modelId && !input.status) return jobId;
      return undefined;
    },
    scheduler: {
      runAfter: async () => "scheduled_event",
      runAt: async () => "scheduled_event",
    },
    storage: {
      get: async () => null,
      getUrl: async () => null,
      store: async (blob: Blob) => {
        blobs.push(blob);
        return "storage_audio" as Id<"_storage">;
      },
    },
  });

  const deps = createRunParticipantTurnDepsForTest({
    getRequiredUserOpenRouterApiKey: async () => "key",
    loadMemoryContext: async () => undefined,
    buildRequestMessages: () => [{ role: "user", content: "Create a short song" }],
    promoteLatestUserVideoUrls: (messages) => ({ messages, events: [] }),
    createStreamWriter: () => ({
      handleContentDeltaBoundary: async () => undefined,
      appendContent: async () => undefined,
      patchContentIfNeeded: async () => undefined,
      appendReasoning: async () => undefined,
      patchReasoningIfNeeded: async () => undefined,
      flush: async () => undefined,
      totalReasoning: "",
      hasSeenContentDelta: false,
    }) as never,
    callOpenRouterStreaming: async (_key, _model, _messages, params) => {
      requestParams.push(params);
      return {
        content: args.content,
        reasoning: "",
        usage: null,
        finishReason: "stop",
        imageUrls: [],
        audioBase64: args.audioBase64,
        audioTranscript: args.transcript,
        toolCalls: [],
        annotations: [],
        generationId: null,
      };
    },
  });

  const outcome = await runParticipantTurn({
    ctx,
    sessionId: "session_audio" as Id<"autonomousSessions">,
    chatId: "chat_audio" as Id<"chats">,
    participant: {
      participantId: "participant_audio",
      modelId: "audio_model",
      displayName: "Audio model",
      temperature: 0.4,
      maxTokens: 300,
    },
    cycleParentIds: ["message_user" as Id<"messages">],
    modelCapabilities: new Map([
      ["audio_model", {
        provider: "openai",
        supportedParameters: ["temperature"],
        hasAudioOutput: true,
        hasReasoning: false,
      }],
    ]),
    memoryContext: undefined,
    userId: "user_audio",
    webSearchEnabled: false,
  }, deps);

  return { blobs, mutations, requestParams, outcome };
}

test("Autonomous Discussion requests and persists capability-driven model audio", async () => {
  const source = Buffer.from("ID3autonomous-audio", "utf8");
  const result = await executeAudioTurn({
    audioBase64: source.toString("base64"),
    content: "",
    transcript: "A short generated song.",
  });

  assert.deepEqual(result.outcome, { kind: "completed", messageId: "message_audio" });
  assert.deepEqual(result.requestParams[0]?.modalities, ["text", "audio"]);
  assert.deepEqual(result.requestParams[0]?.audio, {
    voice: "alloy",
    format: "pcm16",
  });

  assert.equal(result.blobs.length, 1);
  assert.equal(result.blobs[0]?.type, "audio/mpeg");
  assert.deepEqual(Buffer.from(await result.blobs[0]!.arrayBuffer()), source);

  const finalized = result.mutations.find((entry) => entry.status === "completed");
  assert.equal(finalized?.content, "A short generated song.");
  assert.equal(finalized?.audioStorageId, "storage_audio");
  assert.equal(finalized?.audioMimeType, "audio/mpeg");
  assert.equal(finalized?.audioTranscript, "A short generated song.");
  assert.equal(finalized?.audioSizeBytes, source.length);
});

test("Autonomous Discussion accepts playable audio with no text or transcript", async () => {
  const pcm = Buffer.alloc(48_000, 1);
  const result = await executeAudioTurn({
    audioBase64: pcm.toString("base64"),
    content: "",
    transcript: "",
  });

  assert.deepEqual(result.outcome, { kind: "completed", messageId: "message_audio" });
  assert.equal(result.mutations.some((entry) => entry.status === "failed"), false);
  const finalized = result.mutations.find((entry) => entry.status === "completed");
  assert.equal(finalized?.content, "");
  assert.equal(finalized?.audioMimeType, "audio/wav");
  assert.equal(result.blobs[0]?.type, "audio/wav");
});
