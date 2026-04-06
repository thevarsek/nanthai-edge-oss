import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSeedTitle,
  fallbackTitleFromSource,
  isPlaceholderTitle,
  normalizedGeneratedTitle,
} from "../chat/title_helpers";

test("isPlaceholderTitle matches known placeholder values", () => {
  assert.equal(isPlaceholderTitle("New conversation"), true);
  assert.equal(isPlaceholderTitle(" Welcome to NanthAI Edge "), true);
  assert.equal(isPlaceholderTitle("Roadmap discussion"), false);
});

test("buildSeedTitle trims and caps to six words", () => {
  assert.equal(
    buildSeedTitle("  this is a seven word title candidate  "),
    "this is a seven word title",
  );
});

test("normalizedGeneratedTitle strips wrappers and first line only", () => {
  assert.equal(
    normalizedGeneratedTitle("\"Growth Strategy\n(keep this out)\""),
    "Growth Strategy",
  );
});

test("fallbackTitleFromSource prefers user source then assistant source", () => {
  assert.equal(
    fallbackTitleFromSource("Deep dive on product analytics"),
    "Deep dive on product analytics",
  );
  assert.equal(
    fallbackTitleFromSource(" ", "assistant generated context title"),
    "assistant generated context title",
  );
});
