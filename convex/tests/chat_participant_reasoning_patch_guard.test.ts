import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldForceParticipantReasoningPatch,
  shouldInjectDateContext,
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

test("shouldInjectDateContext stays false for cacheable plain chat", () => {
  assert.equal(
    shouldInjectDateContext({
      webSearchEnabled: false,
      enabledIntegrations: [],
      activeProfiles: [],
      loadedSkills: [],
    }),
    false,
  );
});

test("shouldInjectDateContext enables search and calendar-like tool turns", () => {
  assert.equal(shouldInjectDateContext({ webSearchEnabled: true }), true);
  assert.equal(
    shouldInjectDateContext({
      webSearchEnabled: false,
      enabledIntegrations: ["calendar"],
    }),
    true,
  );
  assert.equal(
    shouldInjectDateContext({
      webSearchEnabled: false,
      loadedSkills: [
        {
          skill: "calendar-scheduler",
          instructions: "Use calendar tools.",
          requiredToolProfiles: ["microsoft"],
          requiredToolIds: ["ms_calendar_list"],
          requiredIntegrationIds: ["ms_calendar"],
          requiredCapabilities: [],
        },
      ],
    }),
    true,
  );
});
