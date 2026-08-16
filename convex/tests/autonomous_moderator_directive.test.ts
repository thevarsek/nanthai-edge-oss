import assert from "node:assert/strict";
import test from "node:test";

import {
  fallbackModeratorDirective,
  moderatorDirectiveResponseFormat,
  normalizeModeratorDirective,
} from "../autonomous/moderator_directive";

test("moderator directive accepts bounded plain and structured guidance", () => {
  assert.equal(
    normalizeModeratorDirective("Add one concrete example before drawing a conclusion."),
    "Add one concrete example before drawing a conclusion.",
  );
  assert.equal(
    normalizeModeratorDirective(JSON.stringify({
      directive: "Clarify which tradeoff matters most before recommending a path.",
    })),
    "Clarify which tradeoff matters most before recommending a path.",
  );
});

test("moderator directive rejects truncated and template-like fragments", () => {
  for (const fragment of ["5", ": Asks", "suggests doing", "/user"]) {
    assert.equal(normalizeModeratorDirective(fragment), undefined);
  }
  assert.equal(
    normalizeModeratorDirective('{"directive":"Compare the unresolved'),
    undefined,
  );
  assert.equal(
    normalizeModeratorDirective("Add one concrete example before deciding.", "length"),
    undefined,
  );
});

test("moderator directive fallback and schema stay bounded", () => {
  assert.match(fallbackModeratorDirective(), /strongest unresolved point/);
  assert.equal(
    moderatorDirectiveResponseFormat.json_schema.schema.additionalProperties,
    false,
  );
  assert.deepEqual(
    moderatorDirectiveResponseFormat.json_schema.schema.required,
    ["directive"],
  );
});
