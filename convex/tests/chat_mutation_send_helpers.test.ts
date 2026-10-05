import assert from "node:assert/strict";
import test from "node:test";

import {
  createAssistantMessagesAndJobs,
  mapParticipantsForGeneration,
  normalizeParticipants,
  selectMentionedParticipants,
} from "../chat/mutation_send_helpers";
import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";

test("normalizeParticipants applies fallback model when empty", () => {
  const normalized = normalizeParticipants([], "openai/gpt-5.2");
  assert.deepEqual(normalized, [{ modelId: "openai/gpt-5.2" }]);
});

test("selectMentionedParticipants preserves all participants when no mention is supplied", () => {
  const selected = selectMentionedParticipants([
    { participantKey: "participant_1", modelId: "model-a" },
    { participantKey: "participant_2", modelId: "model-b" },
  ], undefined);

  assert.deepEqual(selected, [
    { participantKey: "participant_1", modelId: "model-a" },
    { participantKey: "participant_2", modelId: "model-b" },
  ]);
});

test("selectMentionedParticipants targets one or multiple participants in chat order", () => {
  const participants = [
    { participantKey: "participant_1", modelId: "model-a" },
    { participantKey: "participant_2", modelId: "model-b" },
    { participantKey: "participant_3", modelId: "model-c" },
  ];

  assert.deepEqual(
    selectMentionedParticipants(participants, ["participant_2"]),
    [{ participantKey: "participant_2", modelId: "model-b" }],
  );
  assert.deepEqual(
    selectMentionedParticipants(participants, ["participant_3", "participant_1"]),
    [
      { participantKey: "participant_1", modelId: "model-a" },
      { participantKey: "participant_3", modelId: "model-c" },
    ],
  );
});

test("selectMentionedParticipants rejects stale, duplicate, and ambiguous keys", () => {
  const participants = [
    { participantKey: "participant_1", modelId: "model-a" },
    { participantKey: "participant_2", modelId: "model-b" },
  ];

  for (const mentionedParticipantKeys of [
    ["missing"],
    ["participant_1", "participant_1"],
  ]) {
    assert.throws(
      () => selectMentionedParticipants(participants, mentionedParticipantKeys),
      (error) => error instanceof ConvexError && error.data.code === "VALIDATION",
    );
  }

  assert.throws(
    () => selectMentionedParticipants([
      { participantKey: "duplicate", modelId: "model-a" },
      { participantKey: "duplicate", modelId: "model-b" },
    ], ["duplicate"]),
    (error) => error instanceof ConvexError && error.data.code === "VALIDATION",
  );
});

test("mapParticipantsForGeneration normalizes nullable fields", () => {
  const mapped = mapParticipantsForGeneration(
    [
      {
        participantKey: "participant_1",
        modelId: "model-a",
        personaId: null,
        personaName: "Analyst",
        personaEmoji: null,
        systemPrompt: null,
        reasoningEffort: null,
      },
    ],
    ["m1" as any],
    ["j1" as any],
  );

  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].personaId, undefined);
  assert.equal(mapped[0].personaEmoji, undefined);
  assert.equal(mapped[0].systemPrompt, undefined);
  assert.equal(mapped[0].reasoningEffort, undefined);
  assert.equal(mapped[0].chatParticipantId, "participant_1");
  assert.equal("participantKey" in mapped[0], false);
  assert.equal(mapped[0].messageId, "m1");
  assert.equal(mapped[0].jobId, "j1");
});

test("send-time eager execution captures the current local Persona configuration", async () => {
  const now = Date.now();
  const rows: Record<string, Array<Record<string, unknown>>> = {
    chats: [{ _id: "chat_1", userId: "user_1" }],
    personas: [{ _id: "persona_1", userId: "user_1", displayName: "Current Persona", systemPrompt: "Current prompt" }],
    chatParticipants: [{
      _id: "participant_1",
      userId: "user_1",
      chatId: "chat_1",
      personaId: "persona_1",
      modelId: "openai/gpt-5.6",
    }],
    personaRuntimeBindings: [{
      _id: "route_1",
      userId: "user_1",
      chatId: "chat_1",
      chatParticipantId: "participant_1",
      personaId: "persona_1",
      placement: "local",
      status: "active",
      deviceId: "device-1",
      adapterId: "codex",
      modelSelectionMode: "adapter_default",
      routeHash: "route-hash-1",
    }],
    chatRuntimeOverrides: [],
    runtimeDevices: [{
      _id: "runtime_device_1",
      userId: "user_1",
      deviceId: "device-1",
      displayName: "Dino MacBook",
      status: "active",
      currentPresenceId: "presence_1",
    }],
    runtimeDevicePresences: [{
      _id: "presence_1",
      status: "online",
      expiresAt: now + 60_000,
      adapters: [{ adapterId: "codex", authState: "ready" }],
    }],
    accountDeletionTombstones: [],
    messages: [],
    streamingMessages: [],
    generationJobs: [],
    executionRuns: [],
    executionAttempts: [],
    runEvents: [],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;

  const created = await createAssistantMessagesAndJobs(ctx, {
    chatId: "chat_1" as never,
    userId: "user_1",
    participants: [{
      participantKey: "participant_1",
      personaId: "persona_1" as never,
      modelId: "openai/gpt-5.6",
    }],
    parentMessageIds: ["message_user" as never],
    assistantCreatedAt: now,
    jobCreatedAt: now,
  });

  assert.equal(created.generationJobIds.length, 1);
  assert.equal(rows.generationJobs[0]?.chatParticipantId, "participant_1");
  assert.equal(rows.executionRuns[0]?.requestedPlacement, "local");
  assert.equal(rows.executionAttempts[0]?.executorKind, "local_runtime");
  assert.equal(rows.executionAttempts[0]?.deviceId, "device-1");
  assert.equal(typeof rows.executionAttempts[0]?.routeSnapshotHash, "string");
  assert.equal((rows.generationJobs[0]?.effectivePersonaConfig as { systemPrompt: string }).systemPrompt, "Current prompt");
});
