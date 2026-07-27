import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeScheduledJobToolModelId,
  resolveScheduledJobToolModelId,
} from "../tools/scheduled_jobs_models";

test("scheduled job model selection prefers explicit, then invoking, then default", () => {
  assert.equal(
    resolveScheduledJobToolModelId(
      "anthropic/claude-sonnet-4.6",
      "openai/gpt-5.6-terra",
      "google/gemini-2.5-flash",
    ),
    "anthropic/claude-sonnet-4.6",
  );
  assert.equal(
    resolveScheduledJobToolModelId(
      undefined,
      "openai/gpt-5.6-terra",
      "google/gemini-2.5-flash",
    ),
    "openai/gpt-5.6-terra",
  );
  assert.equal(
    resolveScheduledJobToolModelId(
      undefined,
      undefined,
      "google/gemini-2.5-flash",
    ),
    "google/gemini-2.5-flash",
  );
});

test("scheduled job model selection ignores blank and non-string values", () => {
  assert.equal(normalizeScheduledJobToolModelId("  "), undefined);
  assert.equal(normalizeScheduledJobToolModelId(42), undefined);
  assert.equal(
    resolveScheduledJobToolModelId("  ", " openai/gpt-5.6-terra "),
    "openai/gpt-5.6-terra",
  );
});
