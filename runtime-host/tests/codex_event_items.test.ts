import assert from "node:assert/strict";
import test from "node:test";

import { textChunks } from "../src/codex_event_items.ts";

test("does not split a surrogate pair at the event boundary", () => {
  const value = `${"a".repeat(9)}😀tail`;
  const chunks = textChunks(value, 10);

  assert.deepEqual(chunks, ["a".repeat(9), "😀tail"]);
  assert.equal(chunks.join(""), value);
  assert.equal(chunks.some((chunk) => chunk.includes("�")), false);
});
