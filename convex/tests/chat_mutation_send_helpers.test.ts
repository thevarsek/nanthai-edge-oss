import assert from "node:assert/strict";
import test from "node:test";

import {
  mapParticipantsForGeneration,
  normalizeParticipants,
  selectMentionedParticipants,
} from "../chat/mutation_send_helpers";
import { ConvexError } from "convex/values";

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
    { modelId: "model-a" },
    { modelId: "model-b" },
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
    [{ modelId: "model-b" }],
  );
  assert.deepEqual(
    selectMentionedParticipants(participants, ["participant_3", "participant_1"]),
    [{ modelId: "model-a" }, { modelId: "model-c" }],
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
  assert.equal(mapped[0].messageId, "m1");
  assert.equal(mapped[0].jobId, "j1");
});
