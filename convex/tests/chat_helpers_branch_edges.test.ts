import assert from "node:assert/strict";
import test from "node:test";

import { buildRequestMessages, formatMemoryContext } from "../chat/helpers";

test("buildRequestMessages handles empty branches, skipped statuses, and memory system sections", () => {
  assert.deepEqual(buildRequestMessages({
    messages: [],
    excludeMessageId: "missing" as any,
  }), []);

  const messages = [
    {
      _id: "user_1",
      role: "user",
      content: "Draft the update",
      parentMessageIds: [],
      status: "completed",
      createdAt: 1,
    },
    {
      _id: "assistant_failed",
      role: "assistant",
      content: "bad",
      parentMessageIds: ["user_1"],
      status: "failed",
      createdAt: 2,
    },
    {
      _id: "assistant_1",
      role: "assistant",
      content: "done",
      parentMessageIds: ["user_1"],
      participantName: "PM Lead!",
      status: "completed",
      createdAt: 3,
    },
  ] as any[];

  const built = buildRequestMessages({
    messages,
    excludeMessageId: "assistant_1" as any,
    systemPrompt: "System",
    memoryContext: "Memory",
  });

  assert.deepEqual(built.map((message) => message.role), ["system", "system", "user"]);
  assert.equal(built[0].content, "System");
  assert.equal(built[1].content, "Memory");
  assert.equal(built[2].content, "Draft the update");
});

test("formatMemoryContext groups pinned preferences, profile facts, and contextual memories", () => {
  const memoryContext = formatMemoryContext([
    {
      content: "Use terse answers.",
      isPinned: true,
      memoryType: "responsePreference",
      retrievalMode: "alwaysOn",
    },
    {
      content: "Works on iOS.",
      isPinned: false,
      memoryType: "profile",
      category: "skills",
    },
    {
      content: "Current project is coverage.",
      isPinned: true,
      memoryType: "workContext",
      category: "project",
    },
  ]);

  assert.match(memoryContext ?? "", /Response preferences:/);
  assert.match(memoryContext ?? "", /User profile:/);
  assert.match(memoryContext ?? "", /Relevant context:/);
  assert.match(memoryContext ?? "", /Use terse answers\. \[pinned\]/);
  assert.equal(formatMemoryContext([]), undefined);
});
