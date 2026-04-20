import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldForceReasoningPatchOnContentStart,
  shouldPatchStreamingContent,
  shouldPatchStreamingReasoning,
  STREAM_PATCH_THRESHOLDS,
} from "../chat/stream_patch_throttle";

test("STREAM_PATCH_THRESHOLDS has expected values (guard against accidental changes)", () => {
  assert.equal(STREAM_PATCH_THRESHOLDS.firstContentPatchChars, 40);
  assert.equal(STREAM_PATCH_THRESHOLDS.firstContentPatchMaxDelayMs, 175);
  assert.equal(STREAM_PATCH_THRESHOLDS.contentPatchMinIntervalMs, 300);
  assert.equal(STREAM_PATCH_THRESHOLDS.contentPatchMinChars, 120);
  assert.equal(STREAM_PATCH_THRESHOLDS.firstReasoningPatchChars, 40);
  assert.equal(STREAM_PATCH_THRESHOLDS.firstReasoningPatchMaxDelayMs, 175);
  assert.equal(STREAM_PATCH_THRESHOLDS.reasoningPatchMinIntervalMs, 300);
  assert.equal(STREAM_PATCH_THRESHOLDS.reasoningPatchMinChars, 120);
});

test("shouldPatchStreamingContent returns false when no new content, true when forced", () => {
  const noNewContent = shouldPatchStreamingContent({
    nowMs: 1_000,
    totalContentLength: 500,
    lastPatchedContentLength: 500,
    lastPatchedContentAtMs: 0,
  });

  assert.equal(noNewContent, false);

  const forcedPatch = shouldPatchStreamingContent({
    force: true,
    nowMs: 1_000,
    totalContentLength: 0,
    lastPatchedContentLength: 0,
    lastPatchedContentAtMs: 0,
  });

  assert.equal(forcedPatch, true);
});

test("shouldPatchStreamingContent patches first update only after minimum chars", () => {
  const underThreshold = shouldPatchStreamingContent({
    nowMs: 1_000,
    totalContentLength: STREAM_PATCH_THRESHOLDS.firstContentPatchChars - 1,
    lastPatchedContentLength: 0,
    lastPatchedContentAtMs: 0,
    contentStartedAtMs: 950,
  });
  assert.equal(underThreshold, false);

  const atThreshold = shouldPatchStreamingContent({
    nowMs: 1_000,
    totalContentLength: STREAM_PATCH_THRESHOLDS.firstContentPatchChars,
    lastPatchedContentLength: 0,
    lastPatchedContentAtMs: 0,
    contentStartedAtMs: 950,
  });
  assert.equal(atThreshold, true);
});

test("shouldPatchStreamingContent allows the first patch after a short max delay", () => {
  const delayedFirstPatch = shouldPatchStreamingContent({
    nowMs: 1_000,
    totalContentLength: 8,
    lastPatchedContentLength: 0,
    lastPatchedContentAtMs: 0,
    contentStartedAtMs: 800,
  });
  assert.equal(delayedFirstPatch, true);
});

test("shouldPatchStreamingContent patches on interval or character delta after first patch", () => {
  const byInterval = shouldPatchStreamingContent({
    nowMs: 4_000,
    totalContentLength: 300,
    lastPatchedContentLength: 250,
    lastPatchedContentAtMs: 3_000,
  });
  assert.equal(byInterval, true);

  const byCharDelta = shouldPatchStreamingContent({
    nowMs: 3_100,
    totalContentLength: 1_000,
    lastPatchedContentLength: 400,
    lastPatchedContentAtMs: 3_000,
  });
  assert.equal(byCharDelta, true);
});

test("shouldPatchStreamingReasoning follows cadence and supports force flush", () => {
  const notYet = shouldPatchStreamingReasoning({
    nowMs: 10_000,
    totalReasoningLength: STREAM_PATCH_THRESHOLDS.firstReasoningPatchChars - 1,
    lastPatchedReasoningLength: 0,
    lastPatchedReasoningAtMs: 0,
  });
  assert.equal(notYet, false);

  const enoughFirst = shouldPatchStreamingReasoning({
    nowMs: 10_000,
    totalReasoningLength: STREAM_PATCH_THRESHOLDS.firstReasoningPatchChars,
    lastPatchedReasoningLength: 0,
    lastPatchedReasoningAtMs: 0,
  });
  assert.equal(enoughFirst, true);

  const forced = shouldPatchStreamingReasoning({
    force: true,
    nowMs: 10_001,
    totalReasoningLength: 1,
    lastPatchedReasoningLength: 1,
    lastPatchedReasoningAtMs: 10_000,
  });
  assert.equal(forced, true);
});

test("shouldPatchStreamingReasoning allows the first patch after a short max delay even below char threshold", () => {
  const belowCharThreshold = STREAM_PATCH_THRESHOLDS.firstReasoningPatchChars - 1;
  const timeoutExceeded =
    STREAM_PATCH_THRESHOLDS.firstReasoningPatchMaxDelayMs + 10;

  // Before timeout elapses: no patch yet (below char threshold).
  const notYet = shouldPatchStreamingReasoning({
    nowMs: 800,
    totalReasoningLength: belowCharThreshold,
    lastPatchedReasoningLength: 0,
    lastPatchedReasoningAtMs: 0,
    reasoningStartedAtMs: 750,
  });
  assert.equal(notYet, false);

  // After timeout: patch forced even with very little content, so users
  // see the reasoning UI appear promptly on slow reasoning streams.
  const delayedFirstPatch = shouldPatchStreamingReasoning({
    nowMs: 1_000 + timeoutExceeded,
    totalReasoningLength: belowCharThreshold,
    lastPatchedReasoningLength: 0,
    lastPatchedReasoningAtMs: 0,
    reasoningStartedAtMs: 1_000,
  });
  assert.equal(delayedFirstPatch, true);
});

test("shouldForceReasoningPatchOnContentStart only at first content boundary with pending reasoning", () => {
  const shouldForce = shouldForceReasoningPatchOnContentStart({
    hasSeenContentDelta: false,
    incomingContentDeltaLength: 5,
    totalReasoningLength: 220,
    lastPatchedReasoningLength: 200,
  });
  assert.equal(shouldForce, true);

  const alreadySeenContent = shouldForceReasoningPatchOnContentStart({
    hasSeenContentDelta: true,
    incomingContentDeltaLength: 5,
    totalReasoningLength: 220,
    lastPatchedReasoningLength: 200,
  });
  assert.equal(alreadySeenContent, false);

  const noPendingReasoning = shouldForceReasoningPatchOnContentStart({
    hasSeenContentDelta: false,
    incomingContentDeltaLength: 5,
    totalReasoningLength: 220,
    lastPatchedReasoningLength: 220,
  });
  assert.equal(noPendingReasoning, false);
});
