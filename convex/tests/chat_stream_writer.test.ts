import assert from "node:assert/strict";
import test from "node:test";

import { StreamWriter, StreamWriterOptions } from "../chat/stream_writer";
import { ActionCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

// ---------------------------------------------------------------------------
// Helpers — lightweight mock for ActionCtx.runMutation
// ---------------------------------------------------------------------------

interface MutationCall {
  name: string;
  args: Record<string, unknown>;
}

function createMockCtx(): { ctx: ActionCtx; calls: MutationCall[] } {
  const calls: MutationCall[] = [];
  const ctx = {
    runMutation: async (ref: unknown, args: unknown) => {
      // Convex function references are objects that can't be string-coerced;
      // use JSON.stringify as a safe fallback.
      let name: string;
      try {
        name = typeof ref === "string" ? ref : JSON.stringify(ref);
      } catch {
        name = "<unknown>";
      }
      calls.push({ name, args: args as Record<string, unknown> });
    },
  } as unknown as ActionCtx;
  return { ctx, calls };
}

function createWriter(
  overrides: Partial<StreamWriterOptions> = {},
): { writer: StreamWriter; calls: MutationCall[] } {
  const { ctx, calls } = createMockCtx();
  const writer = new StreamWriter({
    ctx,
    messageId: "test_message_id" as Id<"messages">,
    ...overrides,
  });
  return { writer, calls };
}

// ---------------------------------------------------------------------------
// Tests — content accumulation
// ---------------------------------------------------------------------------

test("appendContent accumulates deltas", async () => {
  const { writer } = createWriter();
  await writer.appendContent("Hello");
  await writer.appendContent(", world");
  assert.equal(writer.totalContent, "Hello, world");
});

test("appendContent ignores empty deltas", async () => {
  const { writer } = createWriter();
  await writer.appendContent("");
  assert.equal(writer.totalContent, "");
});

// ---------------------------------------------------------------------------
// Tests — content patching cadence
// ---------------------------------------------------------------------------

test("patchContentIfNeeded does not patch below first-patch threshold", async () => {
  const { writer, calls } = createWriter();
  // Append fewer chars than firstContentPatchChars (40).
  await writer.appendContent("abc");
  await writer.patchContentIfNeeded();
  assert.equal(calls.length, 0);
});

test("patchContentIfNeeded patches at first-patch threshold", async () => {
  const { writer, calls } = createWriter();
  await writer.appendContent("a".repeat(40));
  await writer.patchContentIfNeeded();
  assert.equal(calls.length, 1);
  assert.equal(
    (calls[0].args as Record<string, unknown>).content,
    "a".repeat(40),
  );
});

test("patchContentIfNeeded force-patches regardless of threshold", async () => {
  const { writer, calls } = createWriter();
  await writer.appendContent("a");
  await writer.patchContentIfNeeded(true);
  assert.equal(calls.length, 1);
});

test("patchContentIfNeeded applies transformContent", async () => {
  const { writer, calls } = createWriter({
    transformContent: (c) => c.toUpperCase(),
  });
  await writer.appendContent("a".repeat(40));
  await writer.patchContentIfNeeded();
  assert.equal(
    (calls[0].args as Record<string, unknown>).content,
    "A".repeat(40),
  );
});

// ---------------------------------------------------------------------------
// Tests — beforePatch hook placement
// ---------------------------------------------------------------------------

test("beforePatch is NOT called when throttle check returns false", async () => {
  let hookCalled = false;
  const { writer } = createWriter({
    beforePatch: async () => {
      hookCalled = true;
    },
  });
  // Below threshold — hook should not fire.
  await writer.appendContent("abc");
  await writer.patchContentIfNeeded();
  assert.equal(hookCalled, false);
});

test("beforePatch IS called when throttle check passes", async () => {
  let hookCalled = false;
  const { writer } = createWriter({
    beforePatch: async () => {
      hookCalled = true;
    },
  });
  await writer.appendContent("a".repeat(40));
  await writer.patchContentIfNeeded();
  assert.equal(hookCalled, true);
});

test("beforePatch throwing aborts the patch", async () => {
  const { writer, calls } = createWriter({
    beforePatch: async () => {
      throw new Error("cancelled");
    },
  });
  await writer.appendContent("a".repeat(40));
  await assert.rejects(() => writer.patchContentIfNeeded(), {
    message: "cancelled",
  });
  // The mutation should not have been called.
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Tests — reasoning accumulation and patching
// ---------------------------------------------------------------------------

test("appendReasoning accumulates and ignores empty", async () => {
  const { writer } = createWriter();
  await writer.appendReasoning("step 1");
  await writer.appendReasoning("");
  await writer.appendReasoning(", step 2");
  assert.equal(writer.totalReasoning, "step 1, step 2");
});

test("patchReasoningIfNeeded respects shouldPersistReasoning guard", async () => {
  const { writer, calls } = createWriter({
    shouldPersistReasoning: () => false,
  });
  await writer.appendReasoning("a".repeat(100));
  await writer.patchReasoningIfNeeded(true);
  assert.equal(calls.length, 0);
});

test("patchReasoningIfNeeded patches at first-reasoning threshold", async () => {
  const { writer, calls } = createWriter();
  await writer.appendReasoning("r".repeat(40));
  await writer.patchReasoningIfNeeded();
  assert.equal(calls.length, 1);
  assert.equal(
    (calls[0].args as Record<string, unknown>).reasoning,
    "r".repeat(40),
  );
});

// ---------------------------------------------------------------------------
// Tests — reasoning→content boundary flush
// ---------------------------------------------------------------------------

test("handleContentDeltaBoundary force-flushes unpersisted reasoning on first content delta", async () => {
  const { writer, calls } = createWriter();
  // Accumulate reasoning but do not patch it.
  await writer.appendReasoning("thinking...");
  assert.equal(writer.hasSeenContentDelta, false);

  // First content delta arrives — should force-flush reasoning.
  await writer.handleContentDeltaBoundary(5);
  assert.equal(writer.hasSeenContentDelta, true);
  // Reasoning should have been force-patched.
  assert.equal(calls.length, 1);
  assert.equal(
    (calls[0].args as Record<string, unknown>).reasoning,
    "thinking...",
  );
});

test("handleContentDeltaBoundary does nothing on subsequent content deltas", async () => {
  const { writer, calls } = createWriter();
  await writer.appendReasoning("thinking...");
  // First delta — triggers flush.
  await writer.handleContentDeltaBoundary(5);
  const firstCallCount = calls.length;

  // Second delta — should NOT trigger another reasoning flush.
  await writer.appendReasoning(" more");
  await writer.handleContentDeltaBoundary(3);
  assert.equal(calls.length, firstCallCount);
});

test("handleContentDeltaBoundary skips when no pending reasoning", async () => {
  const { writer, calls } = createWriter();
  // No reasoning accumulated — boundary should be a no-op.
  await writer.handleContentDeltaBoundary(5);
  assert.equal(calls.length, 0);
  assert.equal(writer.hasSeenContentDelta, true);
});

// ---------------------------------------------------------------------------
// Tests — flush
// ---------------------------------------------------------------------------

test("flush force-flushes both content and reasoning", async () => {
  const { writer, calls } = createWriter();
  await writer.appendContent("content");
  await writer.appendReasoning("reasoning");
  await writer.flush();
  // Should have two mutation calls: one for content, one for reasoning.
  assert.equal(calls.length, 2);
});

test("flush on empty writer still force-patches content (force=true bypasses cadence)", async () => {
  const { writer, calls } = createWriter();
  await writer.flush();
  // force=true bypasses the cadence check, so patchContentIfNeeded writes even
  // with empty content. Reasoning is not written because shouldPersistReasoning
  // defaults to a truthy check on length, and the cadence addedLength is 0.
  assert.equal(calls.length, 1);
  assert.equal(
    (calls[0].args as Record<string, unknown>).content,
    "",
  );
});
