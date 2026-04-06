import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMemoryType,
  computeLifecycleScores,
  findConflictingMemory,
  isMemoryActive,
  selectMemoriesForContext,
} from "../chat/actions_memory_lifecycle";

test("classifyMemoryType routes profile, preference, work, transient", () => {
  assert.equal(classifyMemoryType("User prefers concise responses."), "responsePreference");
  assert.equal(classifyMemoryType("User's name is Dino."), "profile");
  assert.equal(classifyMemoryType("User is director of data and development."), "profile");
  assert.equal(classifyMemoryType("User is a carpenter."), "profile");
  assert.equal(classifyMemoryType("User is building a new iOS app."), "workContext");
  assert.equal(classifyMemoryType("User is curious about Rust today."), "transient");
});

test("computeLifecycleScores returns bounded scores and expected expiry behavior", () => {
  const now = Date.now();
  const preference = computeLifecycleScores(
    "User prefers concise and direct responses.",
    "responsePreference",
    now,
  );
  assert.ok(preference.importanceScore > 0.9);
  assert.ok(preference.confidenceScore > 0.5);
  assert.equal(preference.expiresAt, undefined);

  const transient = computeLifecycleScores(
    "User is exploring options today.",
    "transient",
    now,
  );
  assert.ok(typeof transient.expiresAt === "number");
  assert.ok((transient.expiresAt ?? 0) > now);
});

test("findConflictingMemory detects opposite response-length preferences", () => {
  const existing = [
    {
      _id: "m1",
      content: "User prefers concise responses.",
      memoryType: "responsePreference",
    },
  ];

  const conflicting = findConflictingMemory(
    "User prefers detailed responses.",
    "responsePreference",
    existing,
  );
  assert.equal(conflicting?._id, "m1");
});

test("selectMemoriesForContext prioritizes active preference memories", () => {
  const now = Date.now();
  const selected = selectMemoriesForContext(
    [
      {
        _id: "pref",
        content: "User prefers concise responses.",
        memoryType: "responsePreference",
        importanceScore: 0.95,
        updatedAt: now,
      },
      {
        _id: "expired",
        content: "User is exploring a temporary tool.",
        memoryType: "transient",
        importanceScore: 0.7,
        expiresAt: now - 1_000,
        updatedAt: now,
      },
      {
        _id: "pending",
        content: "User works at Company X.",
        memoryType: "profile",
        importanceScore: 0.8,
        isPending: true,
        updatedAt: now,
      },
      {
        _id: "work",
        content: "User is building an iOS app with Convex backend.",
        memoryType: "workContext",
        importanceScore: 0.75,
        updatedAt: now,
      },
    ],
    "Please respond briefly about the app architecture",
    3,
  );

  assert.equal(selected.length, 2);
  assert.equal(selected[0]._id, "pref");
  assert.ok(selected.some((memory) => memory._id === "work"));
  assert.ok(selected.every((memory) => isMemoryActive(memory)));
});
