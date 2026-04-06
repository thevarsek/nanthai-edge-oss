import assert from "node:assert/strict";
import test from "node:test";

import { GenerationCancelledError } from "../chat/generation_helpers";
import {
  resolveRegenerationFinalContent,
  shouldCheckRegenerationCancellation,
  throwIfRegenerationCancelled,
} from "../search/actions_regenerate_paper";

test("shouldCheckRegenerationCancellation polls every tenth delta", () => {
  assert.equal(shouldCheckRegenerationCancellation(1), false);
  assert.equal(shouldCheckRegenerationCancellation(9), false);
  assert.equal(shouldCheckRegenerationCancellation(10), true);
  assert.equal(shouldCheckRegenerationCancellation(20), true);
});

test("throwIfRegenerationCancelled throws cancellation error when job is cancelled", async () => {
  const ctx = {
    runMutation: async () => true,
  } as any;

  await assert.rejects(
    throwIfRegenerationCancelled(ctx, "job_1" as any),
    (error: unknown) => error instanceof GenerationCancelledError,
  );
});

test("throwIfRegenerationCancelled is a no-op when job is still active", async () => {
  const ctx = {
    runMutation: async () => false,
  } as any;

  await assert.doesNotReject(
    throwIfRegenerationCancelled(ctx, "job_1" as any),
  );
});

test("resolveRegenerationFinalContent returns reasoning-only placeholder when content is empty", () => {
  assert.equal(
    resolveRegenerationFinalContent("   ", "model reasoning", ""),
    "Model returned reasoning only.",
  );
  assert.equal(
    resolveRegenerationFinalContent("", undefined, "stream reasoning"),
    "Model returned reasoning only.",
  );
});

test("resolveRegenerationFinalContent keeps no-response placeholder when content and reasoning are empty", () => {
  assert.equal(
    resolveRegenerationFinalContent("   ", undefined, ""),
    "[No response received from model]",
  );
});
