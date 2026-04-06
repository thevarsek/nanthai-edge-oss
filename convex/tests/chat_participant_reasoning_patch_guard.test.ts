import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldForceParticipantReasoningPatch,
  shouldPersistParticipantReasoning,
} from "../chat/actions_run_generation_participant.ts";

test("shouldPersistParticipantReasoning rejects empty reasoning payloads", () => {
  assert.equal(shouldPersistParticipantReasoning(""), false);
});

test("shouldPersistParticipantReasoning accepts non-empty reasoning payloads", () => {
  assert.equal(shouldPersistParticipantReasoning("step-by-step"), true);
});

test("shouldForceParticipantReasoningPatch forces flush after sentence boundary", () => {
  assert.equal(
    shouldForceParticipantReasoningPatch("Finished verifying the claim.", false),
    true,
  );
});

test("shouldForceParticipantReasoningPatch avoids forcing mid-sentence before content starts", () => {
  assert.equal(
    shouldForceParticipantReasoningPatch("Need to verify the", false),
    false,
  );
});
