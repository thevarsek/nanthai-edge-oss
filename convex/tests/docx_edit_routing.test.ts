import assert from "node:assert/strict";
import test from "node:test";

import {
  filterDocxReplacementToolDefinitions,
  isExplicitFullDocxReplacementRequest,
  shouldGroundDocumentRelativeDate,
} from "../chat/docx_edit_routing";
import type { ToolDefinition } from "../lib/openrouter_types";

function toolDefinition(name: string): ToolDefinition {
  return {
    type: "function",
    function: {
      name,
      description: name,
      parameters: { type: "object", properties: {} },
    },
  };
}

test("localized DOCX requests hide whole-document replacement", () => {
  const prompt = "can you change the date to be today";
  const filtered = filterDocxReplacementToolDefinitions([
    toolDefinition("read_document"),
    toolDefinition("propose_docx_edits"),
    toolDefinition("edit_docx"),
  ], prompt);

  assert.equal(isExplicitFullDocxReplacementRequest(prompt), false);
  assert.equal(shouldGroundDocumentRelativeDate(prompt, ["read_document"]), true);
  assert.equal(shouldGroundDocumentRelativeDate(prompt, []), false);
  assert.deepEqual(
    filtered.flatMap((definition) =>
      definition.type === "function" ? [definition.function.name] : []
    ),
    ["read_document", "propose_docx_edits"],
  );
});

test("only explicit whole-document replacement exposes edit_docx", () => {
  assert.equal(
    isExplicitFullDocxReplacementRequest("Rewrite the whole document as a shorter agreement"),
    true,
  );
  assert.equal(
    isExplicitFullDocxReplacementRequest("Rewrite section 3 and leave everything else alone"),
    false,
  );
});
