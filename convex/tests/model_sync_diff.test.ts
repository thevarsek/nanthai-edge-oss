import assert from "node:assert/strict";
import test from "node:test";

import {
  deepEqual,
  hasFieldsChanged,
  primitiveArraysEqual,
} from "../models/sync_diff";

test("primitiveArraysEqual and deepEqual support nested values and stable object-key comparison", () => {
  assert.equal(
    primitiveArraysEqual(
      [{ slug: "a", attrs: { price: 1 } }, { slug: "b" }],
      [{ attrs: { price: 1 }, slug: "a" }, { slug: "b" }],
    ),
    true,
  );
  assert.equal(
    deepEqual(
      { a: 1, nested: { values: [1, 2, 3] } },
      { nested: { values: [1, 2, 3] }, a: 1 },
    ),
    true,
  );
  assert.equal(
    deepEqual(
      { values: [1, 2, 3] },
      { values: [3, 2, 1] },
    ),
    false,
  );
});

test("hasFieldsChanged detects only the requested changed fields", () => {
  const existing = {
    slug: "model-a",
    provider: "openai",
    pricing: { input: 1, output: 2 },
  };
  const unchanged = {
    slug: "model-a",
    provider: "openai",
    pricing: { input: 1, output: 2 },
  };
  const changed = {
    slug: "model-a",
    provider: "anthropic",
    pricing: { input: 1, output: 2 },
  };

  assert.equal(hasFieldsChanged(existing, unchanged, ["provider", "pricing"]), false);
  assert.equal(hasFieldsChanged(existing, changed, ["provider", "pricing"]), true);
});
