import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";

export function classifySequenceReplay(
  context: { attempt: Doc<"executionAttempts"> },
  sequence: number,
  eventId: string,
): boolean {
  const last = context.attempt.runtimeLastWorkerSequence;
  if (last === undefined) {
    if (sequence !== 0) {
      throw new ConvexError({ code:
        "RUNTIME_WORKER_SEQUENCE_GAP", message: "Runtime worker sequence did not start at zero" });
    }
    return false;
  }
  if (sequence < last) return true;
  if (sequence === last) {
    if (context.attempt.runtimeLastWorkerEventId !== eventId) {
      throw new ConvexError({ code:
        "RUNTIME_WORKER_SEQUENCE_CONFLICT", message: "Runtime worker sequence was reused by another event" });
    }
    return true;
  }
  if (sequence !== last + 1) {
    throw new ConvexError({ code:
      "RUNTIME_WORKER_SEQUENCE_GAP", message: "Runtime worker event arrived out of sequence" });
  }
  return false;
}

