import assert from "node:assert/strict";
import test from "node:test";

import {
  branchPathIds,
  consolidateConsecutiveRoles,
  contentFromParts,
  sanitizeOpenRouterMessageName,
  truncateMessages,
} from "../chat/helpers_utils";

test("branchPathIds walks ancestor chains and tolerates missing parents", () => {
  const messagesById = new Map([
    ["root", { _id: "root", parentMessageIds: [] }],
    ["mid", { _id: "mid", parentMessageIds: ["root"] }],
    ["leaf", { _id: "leaf", parentMessageIds: ["mid", "missing_parent"] }],
  ]);

  const pathIds = branchPathIds("leaf", messagesById as any);

  assert.deepEqual(
    Array.from(pathIds).sort(),
    ["leaf", "mid", "missing_parent", "root"],
  );
});

test("consolidateConsecutiveRoles merges adjacent runs and preserves non-text parts", () => {
  const consolidated = consolidateConsecutiveRoles([
    { role: "system", content: "system prompt" },
    { role: "user", name: "alice", content: "First note" },
    { role: "user", name: "bob", content: "Second note" },
    {
      role: "user",
      name: "alice",
      content: [
        {
          type: "image_url",
          image_url: { url: "https://cdn.example/image.png" },
        },
      ],
    },
    { role: "assistant", content: "Reply" },
    { role: "assistant", content: "Follow-up" },
  ]);

  assert.equal(consolidated.length, 3);
  assert.equal(consolidated[0]?.role, "system");
  assert.equal(consolidated[1]?.role, "user");
  assert.deepEqual(consolidated[1]?.content, [
    { type: "text", text: "First note\n\n[bob]: Second note" },
    {
      type: "image_url",
      image_url: { url: "https://cdn.example/image.png" },
    },
  ]);
  assert.equal(consolidated[2]?.role, "assistant");
  assert.equal(consolidated[2]?.content, "Reply\n\nFollow-up");
});

test("truncateMessages keeps the newest message and reinserts the latest system prompt", () => {
  const messages = [
    { role: "system", content: "System instruction" },
    { role: "user", content: "A".repeat(80) },
    { role: "assistant", content: "B".repeat(80) },
    { role: "user", content: "Latest question" },
  ];

  const truncated = truncateMessages(messages as any, 4);

  assert.equal(truncated.length, 2);
  assert.equal(truncated[0]?.role, "system");
  assert.equal(truncated[1]?.content, "Latest question");
});

test("sanitizeOpenRouterMessageName normalizes invalid characters and trims empty results", () => {
  assert.equal(
    sanitizeOpenRouterMessageName("  Team Lead!! 42  "),
    "Team_Lead_42",
  );
  assert.equal(sanitizeOpenRouterMessageName("___"), undefined);
  assert.equal(
    sanitizeOpenRouterMessageName("a".repeat(80)),
    "a".repeat(64),
  );
});

test("contentFromParts collapses single text parts and preserves multipart payloads", () => {
  assert.equal(
    contentFromParts([{ type: "text", text: "hello" }]),
    "hello",
  );
  assert.deepEqual(
    contentFromParts([
      { type: "text", text: "hello" },
      { type: "image_url", image_url: { url: "https://cdn.example/image.png" } },
    ]),
    [
      { type: "text", text: "hello" },
      { type: "image_url", image_url: { url: "https://cdn.example/image.png" } },
    ],
  );
});
