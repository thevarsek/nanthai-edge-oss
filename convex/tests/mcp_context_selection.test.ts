import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import { selectRecentMcpInvocationIds } from "../mcp/context_selection";

const message = (index: number) => ({
  _id: `message_${index}` as Id<"messages">,
  mcpInvocationIds: Array.from({ length: 8 }, (_, item) =>
    `invocation_${index}_${item}` as Id<"mcpInvocations">),
});

test("selectRecentMcpInvocationIds retains the newest contexts in chronological order", () => {
  const messages = Array.from({ length: 5 }, (_, index) => message(index));
  const reachable = new Set(messages.map((item) => String(item._id)));

  const selected = selectRecentMcpInvocationIds(messages, reachable);

  assert.equal(selected.length, 32);
  assert.equal(selected[0], "invocation_1_0");
  assert.equal(selected.at(-1), "invocation_4_7");
  assert.equal(selected.includes("invocation_0_7" as Id<"mcpInvocations">), false);
});

test("selectRecentMcpInvocationIds excludes other branches and duplicates", () => {
  const duplicate = "invocation_shared" as Id<"mcpInvocations">;
  const messages = [
    { _id: "message_1" as Id<"messages">, mcpInvocationIds: [duplicate] },
    { _id: "message_2" as Id<"messages">, mcpInvocationIds: [duplicate] },
    { _id: "message_other" as Id<"messages">, mcpInvocationIds: ["other" as Id<"mcpInvocations">] },
  ];

  assert.deepEqual(
    selectRecentMcpInvocationIds(messages, new Set(["message_1", "message_2"])),
    [duplicate],
  );
});
