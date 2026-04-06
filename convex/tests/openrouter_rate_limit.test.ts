import assert from "node:assert/strict";
import test from "node:test";

import { rateLimitDelayMs, retryAfterToMs } from "../lib/openrouter";

test("retryAfterToMs parses delta-seconds headers", () => {
  const delay = retryAfterToMs("1.5");
  assert.equal(delay, 1500);
});

test("retryAfterToMs parses HTTP-date headers", () => {
  const future = new Date(Date.now() + 2500).toUTCString();
  const delay = retryAfterToMs(future);
  assert.ok(delay !== undefined);
  assert.ok(delay! > 0);
  assert.ok(delay! <= 5000);
});

test("retryAfterToMs returns undefined for invalid values", () => {
  assert.equal(retryAfterToMs(""), undefined);
  assert.equal(retryAfterToMs("not-a-date"), undefined);
});

test("rateLimitDelayMs falls back to backoff schedule", () => {
  assert.equal(rateLimitDelayMs(null, 0), 1000);
  assert.equal(rateLimitDelayMs(null, 1), 2000);
  assert.equal(rateLimitDelayMs(null, 3), 4000);
});

test("rateLimitDelayMs prefers Retry-After when present", () => {
  assert.equal(rateLimitDelayMs("3", 0), 3000);
});
