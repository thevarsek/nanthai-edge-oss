export const STREAM_PATCH_THRESHOLDS = {
  firstContentPatchChars: 40,
  firstContentPatchMaxDelayMs: 175,
  contentPatchMinIntervalMs: 300,
  contentPatchMinChars: 120,
  firstReasoningPatchChars: 40,
  firstReasoningPatchMaxDelayMs: 175,
  reasoningPatchMinIntervalMs: 300,
  reasoningPatchMinChars: 120,
} as const;

interface CadenceInput {
  force?: boolean;
  nowMs: number;
  totalLength: number;
  lastPatchedLength: number;
  lastPatchedAtMs: number;
  firstPatchStartedAtMs?: number;
  firstPatchChars: number;
  firstPatchMaxDelayMs?: number;
  minIntervalMs: number;
  minChars: number;
}

function shouldPatchByCadence(input: CadenceInput): boolean {
  if (input.force) return true;

  const addedLength = input.totalLength - input.lastPatchedLength;
  if (addedLength <= 0) return false;

  if (input.lastPatchedAtMs === 0) {
    if (addedLength >= input.firstPatchChars) {
      return true;
    }

    if (
      input.firstPatchStartedAtMs !== undefined &&
      input.firstPatchMaxDelayMs !== undefined &&
      input.nowMs - input.firstPatchStartedAtMs >= input.firstPatchMaxDelayMs
    ) {
      return true;
    }

    return false;
  }

  if (addedLength >= input.minChars) {
    return true;
  }

  return (input.nowMs - input.lastPatchedAtMs) >= input.minIntervalMs;
}

export interface ShouldPatchContentInput {
  force?: boolean;
  nowMs: number;
  totalContentLength: number;
  lastPatchedContentLength: number;
  lastPatchedContentAtMs: number;
  contentStartedAtMs?: number;
}

export function shouldPatchStreamingContent(
  input: ShouldPatchContentInput,
): boolean {
  return shouldPatchByCadence({
    force: input.force,
    nowMs: input.nowMs,
    totalLength: input.totalContentLength,
    lastPatchedLength: input.lastPatchedContentLength,
    lastPatchedAtMs: input.lastPatchedContentAtMs,
    firstPatchStartedAtMs: input.contentStartedAtMs,
    firstPatchChars: STREAM_PATCH_THRESHOLDS.firstContentPatchChars,
    firstPatchMaxDelayMs: STREAM_PATCH_THRESHOLDS.firstContentPatchMaxDelayMs,
    minIntervalMs: STREAM_PATCH_THRESHOLDS.contentPatchMinIntervalMs,
    minChars: STREAM_PATCH_THRESHOLDS.contentPatchMinChars,
  });
}

export interface ShouldPatchReasoningInput {
  force?: boolean;
  nowMs: number;
  totalReasoningLength: number;
  lastPatchedReasoningLength: number;
  lastPatchedReasoningAtMs: number;
  reasoningStartedAtMs?: number;
}

export function shouldPatchStreamingReasoning(
  input: ShouldPatchReasoningInput,
): boolean {
  return shouldPatchByCadence({
    force: input.force,
    nowMs: input.nowMs,
    totalLength: input.totalReasoningLength,
    lastPatchedLength: input.lastPatchedReasoningLength,
    lastPatchedAtMs: input.lastPatchedReasoningAtMs,
    firstPatchStartedAtMs: input.reasoningStartedAtMs,
    firstPatchChars: STREAM_PATCH_THRESHOLDS.firstReasoningPatchChars,
    firstPatchMaxDelayMs: STREAM_PATCH_THRESHOLDS.firstReasoningPatchMaxDelayMs,
    minIntervalMs: STREAM_PATCH_THRESHOLDS.reasoningPatchMinIntervalMs,
    minChars: STREAM_PATCH_THRESHOLDS.reasoningPatchMinChars,
  });
}

export interface ShouldForceReasoningPatchOnContentStartInput {
  hasSeenContentDelta: boolean;
  incomingContentDeltaLength: number;
  totalReasoningLength: number;
  lastPatchedReasoningLength: number;
}

export function shouldForceReasoningPatchOnContentStart(
  input: ShouldForceReasoningPatchOnContentStartInput,
): boolean {
  if (input.hasSeenContentDelta) return false;
  if (input.incomingContentDeltaLength <= 0) return false;
  if (input.totalReasoningLength <= 0) return false;
  return input.totalReasoningLength > input.lastPatchedReasoningLength;
}
