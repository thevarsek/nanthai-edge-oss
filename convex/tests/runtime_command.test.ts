import assert from "node:assert/strict";
import test from "node:test";
import { commandReplayMatches, stableInputHash } from "../execution/commands";

test("runtime command replay accepts exact duplicate input", () => {
  const inputHash = stableInputHash("prompt\nexplicit_user_turn\ncontinue");
  const command = {
    inputHash,
    expectedFence: 7,
    type: "prompt",
    authorizationSource: "explicit_user_turn",
    payload: "continue",
  };
  assert.equal(commandReplayMatches(command, command), true);
});

test("runtime command replay rejects changed payload despite a reused id", () => {
  const existing = {
    inputHash: stableInputHash("prompt\nexplicit_user_turn\ncontinue"),
    expectedFence: 7,
    type: "prompt",
    authorizationSource: "explicit_user_turn",
    payload: "continue",
  };
  assert.equal(commandReplayMatches(existing, { ...existing, payload: "delete it" }), false);
});
