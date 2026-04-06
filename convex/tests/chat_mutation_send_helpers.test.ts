import assert from "node:assert/strict";
import test from "node:test";

import {
  mapParticipantsForGeneration,
  normalizeParticipants,
} from "../chat/mutation_send_helpers";

test("normalizeParticipants applies fallback model when empty", () => {
  const normalized = normalizeParticipants([], "openai/gpt-5.2");
  assert.deepEqual(normalized, [{ modelId: "openai/gpt-5.2" }]);
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
