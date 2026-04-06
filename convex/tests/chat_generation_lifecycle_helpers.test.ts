import assert from "node:assert/strict";
import test from "node:test";

import {
  GenerationCancelledError,
  isGenerationCancelledError,
} from "../chat/generation_helpers";
import { mapFinalMessageStatusToJobStatus } from "../chat/lifecycle_helpers";

test("isGenerationCancelledError detects explicit cancellation errors", () => {
  assert.equal(isGenerationCancelledError(new GenerationCancelledError()), true);
  assert.equal(
    isGenerationCancelledError(new Error("GENERATION CANCELLED by user")),
    true,
  );
  assert.equal(isGenerationCancelledError(new Error("network timeout")), false);
  assert.equal(isGenerationCancelledError("Generation cancelled"), false);
});

test("mapFinalMessageStatusToJobStatus preserves cancelled terminal state", () => {
  assert.equal(mapFinalMessageStatusToJobStatus("completed"), "completed");
  assert.equal(mapFinalMessageStatusToJobStatus("failed"), "failed");
  assert.equal(mapFinalMessageStatusToJobStatus("cancelled"), "cancelled");
});
