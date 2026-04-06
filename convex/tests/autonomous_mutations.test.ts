import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTurnConfiguration,
  computeResumeCursor,
  dedupeParticipantIds,
} from "../autonomous/mutations";

test("dedupeParticipantIds keeps first occurrence order", () => {
  const result = dedupeParticipantIds(["p1", "p2", "p1", "p3", "p2"]);
  assert.deepEqual(result, ["p1", "p2", "p3"]);
});

test("assertTurnConfiguration accepts valid turn setup", () => {
  assert.doesNotThrow(() => {
    assertTurnConfiguration(
      ["p1", "p2"],
      [{ participantId: "p1" }, { participantId: "p2" }],
      undefined,
    );
  });
});

test("assertTurnConfiguration rejects less than two turn-takers", () => {
  assert.throws(() => {
    assertTurnConfiguration(["p1", "p1"], [{ participantId: "p1" }], undefined);
  }, /at least 2 active turn-takers/i);
});

test("assertTurnConfiguration rejects moderator in turn order", () => {
  assert.throws(() => {
    assertTurnConfiguration(
      ["p1", "p2"],
      [{ participantId: "p1" }, { participantId: "p2" }],
      "p2",
    );
  }, /moderator cannot also be in autonomous turn order/i);
});

test("assertTurnConfiguration rejects missing participant config", () => {
  assert.throws(() => {
    assertTurnConfiguration(["p1", "p2"], [{ participantId: "p1" }], undefined);
  }, /missing participant config/i);
});

test("computeResumeCursor advances to next participant in same cycle", () => {
  const result = computeResumeCursor(3, 0, 3);
  assert.deepEqual(result, { resumeCycle: 3, startParticipantIndex: 1 });
});

test("computeResumeCursor rolls to next cycle after last participant", () => {
  const result = computeResumeCursor(2, 2, 3);
  assert.deepEqual(result, { resumeCycle: 3, startParticipantIndex: 0 });
});

test("computeResumeCursor normalizes empty initial state", () => {
  const result = computeResumeCursor(0, undefined, 3);
  assert.deepEqual(result, { resumeCycle: 1, startParticipantIndex: 0 });
});
