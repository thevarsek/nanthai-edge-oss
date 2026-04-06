import assert from "node:assert/strict";
import test from "node:test";

import {
  isMemoryVisibleToPersona,
  normalizeMemoryRecord,
  prioritizeAlwaysOnMemories,
} from "../memory/shared";

test("normalizeMemoryRecord backfills legacy memory metadata", () => {
  const memory = normalizeMemoryRecord({
    content: "User prefers concise responses.",
    memoryType: "responsePreference",
  });

  assert.equal(memory.category, "writingStyle");
  assert.equal(memory.retrievalMode, "alwaysOn");
  assert.equal(memory.scopeType, "allPersonas");
  assert.deepEqual(memory.personaIds, []);
  assert.equal(memory.sourceType, "chat");
});

test("persona visibility includes global and matching persona-scoped memories", () => {
  assert.equal(isMemoryVisibleToPersona({ scopeType: "allPersonas" }, "p1"), true);
  assert.equal(
    isMemoryVisibleToPersona({ scopeType: "selectedPersonas", personaIds: ["p1"] }, "p1"),
    true,
  );
  assert.equal(
    isMemoryVisibleToPersona({ scopeType: "selectedPersonas", personaIds: ["p1"] }, "p2"),
    false,
  );
});

test("always-on prioritization favors writing style and identity", () => {
  const prioritized = prioritizeAlwaysOnMemories(
    [
      {
        _id: "work",
        content: "User works in IP law.",
        category: "work",
        retrievalMode: "alwaysOn",
      },
      {
        _id: "style",
        content: "User prefers concise answers.",
        category: "writingStyle",
        retrievalMode: "alwaysOn",
      },
      {
        _id: "identity",
        content: "User goes by Dino.",
        category: "identity",
        retrievalMode: "alwaysOn",
      },
    ],
    2,
  );

  assert.deepEqual(prioritized.map((item) => item._id), ["style", "identity"]);
});
