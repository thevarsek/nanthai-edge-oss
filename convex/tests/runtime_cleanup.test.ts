import assert from "node:assert/strict";
import test from "node:test";

import { cleanStaleSandboxSessions } from "../runtime/cleanup";
import { getStaleSessionsInternal } from "../runtime/queries";
import { markSessionsDeletedInternal } from "../runtime/mutations";

// ---------------------------------------------------------------------------
// Structural / contract tests for the sandbox-session cleanup action.
//
// The handler dynamically imports @vercel/sandbox and calls internal Convex
// functions, so we cannot exercise it without a real backend. Instead we
// verify the exports that the cron and the action rely on.
// ---------------------------------------------------------------------------

test("cleanStaleSandboxSessions is exported as an internalAction", () => {
  assert.ok(cleanStaleSandboxSessions, "export should be defined");
  assert.ok(["object", "function"].includes(typeof cleanStaleSandboxSessions));
  // Convex function registrations expose an _handler (the raw handler fn)
  assert.equal(typeof (cleanStaleSandboxSessions as any)._handler, "function");
});

test("getStaleSessionsInternal query is exported", () => {
  assert.ok(getStaleSessionsInternal, "export should be defined");
  assert.equal(typeof (getStaleSessionsInternal as any)._handler, "function");
});

test("markSessionsDeletedInternal mutation is exported", () => {
  assert.ok(markSessionsDeletedInternal, "export should be defined");
  assert.equal(typeof (markSessionsDeletedInternal as any)._handler, "function");
});
