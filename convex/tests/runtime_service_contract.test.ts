import assert from "node:assert/strict";
import test from "node:test";

import { createMockCtx } from "../../test_helpers/convex_mock_ctx";
import {
  runWorkspaceCommand,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  makeWorkspaceDirs,
} from "../runtime/service";

// ---------------------------------------------------------------------------
// runWorkspaceCommand — per-generation sandbox
// ---------------------------------------------------------------------------

test("runWorkspaceCommand rejects tool contexts without chatId", async () => {
  await assert.rejects(
    () => runWorkspaceCommand({ userId: "user_1", ctx: createMockCtx({}) } as any, "echo hi"),
    /require chatId/i,
  );
});

test("runWorkspaceCommand returns stdout and exitCode", async () => {
  const toolCtx = { userId: "user_1", chatId: "chat_1", ctx: createMockCtx({}) } as any;
  try {
    const result = await runWorkspaceCommand(toolCtx, "echo hello_world");

    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("hello_world"));
  } finally {
    await toolCtx.workspaceSandboxCleanup?.().catch(() => {});
  }
});

test("runWorkspaceCommand persists files across calls (shared sandbox)", async () => {
  const toolCtx = { userId: "user_1", chatId: "chat_1", ctx: createMockCtx({}) } as any;
  try {
    // Write a file
    await writeWorkspaceFile(toolCtx, "/tmp/nanthai-edge/chat_1/test.txt", "hello", false);
    // Read it back via exec
    const result = await runWorkspaceCommand(toolCtx, "cat /tmp/nanthai-edge/chat_1/test.txt");

    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("hello"));
  } finally {
    await toolCtx.workspaceSandboxCleanup?.().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// listWorkspaceFiles — per-generation sandbox
// ---------------------------------------------------------------------------

test("listWorkspaceFiles rejects tool contexts without chatId", async () => {
  await assert.rejects(
    () => listWorkspaceFiles({ userId: "user_1", ctx: createMockCtx({}) } as any),
    /require chatId/i,
  );
});

test("listWorkspaceFiles returns root path and files array", async () => {
  const toolCtx = { userId: "user_1", chatId: "chat_1", ctx: createMockCtx({}) } as any;
  try {
    const result = await listWorkspaceFiles(toolCtx);

    assert.ok(typeof result.root === "string");
    assert.ok(Array.isArray(result.files));
  } finally {
    await toolCtx.workspaceSandboxCleanup?.().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// readWorkspaceFile
// ---------------------------------------------------------------------------

test("readWorkspaceFile rejects tool contexts without chatId", async () => {
  await assert.rejects(
    () => readWorkspaceFile({ userId: "user_1", ctx: createMockCtx({}) } as any, "/tmp/foo.txt"),
    /require chatId/i,
  );
});

test("readWorkspaceFile returns isBinary for binary paths", async () => {
  const result = await readWorkspaceFile(
    { userId: "user_1", chatId: "chat_1", ctx: createMockCtx({}) } as any,
    "/tmp/nanthai-edge/chat_1/image.png",
  );

  assert.equal(result.isBinary, true);
  assert.ok(typeof result.error === "string");
});

// ---------------------------------------------------------------------------
// writeWorkspaceFile / makeWorkspaceDirs
// ---------------------------------------------------------------------------

test("writeWorkspaceFile rejects tool contexts without chatId", async () => {
  await assert.rejects(
    () =>
      writeWorkspaceFile(
        { userId: "user_1", ctx: createMockCtx({}) } as any,
        "/tmp/foo.txt",
        "content",
        false,
      ),
    /require chatId/i,
  );
});

test("makeWorkspaceDirs rejects tool contexts without chatId", async () => {
  await assert.rejects(
    () =>
      makeWorkspaceDirs(
        { userId: "user_1", ctx: createMockCtx({}) } as any,
        "/tmp/some/dir",
      ),
    /require chatId/i,
  );
});
