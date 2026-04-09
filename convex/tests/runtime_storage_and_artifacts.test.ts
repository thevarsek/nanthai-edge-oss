import assert from "node:assert/strict";
import test from "node:test";

import {
  exportWorkspaceFile,
  resetWorkspace,
} from "../runtime/service_artifacts";
import {
  createRuntimeStorageDepsForTest,
  importOwnedStorageFileToWorkspace,
  resolveOwnedStorageFile,
} from "../runtime/storage";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

test("resolveOwnedStorageFile rejects inaccessible storage ids", async () => {
  await assert.rejects(
    () =>
      resolveOwnedStorageFile(
        {
          userId: "user_1",
          ctx: createMockCtx({
            runQuery: async () => null,
            storage: { get: async () => null },
          }),
        } as any,
        "storage_1",
      ),
    /not available to this user/,
  );
});

test("importOwnedStorageFileToWorkspace requires chatId and imports files into the workspace", async () => {
  await assert.rejects(
    () =>
      importOwnedStorageFileToWorkspace(
        {
          userId: "user_1",
          ctx: {},
        } as any,
        "storage_1",
      ),
    /require chatId/i,
  );

  const makeDirCalls: string[] = [];
  const writeCalls: Array<{ path: string; content: unknown }> = [];
  const mockSandbox = {
    mkDir: async (dir: string) => {
      makeDirCalls.push(dir);
    },
    writeFiles: async (files: Record<string, unknown>) => {
      for (const [path, content] of Object.entries(files)) {
        writeCalls.push({ path, content });
      }
    },
    stop: async () => {},
  };

  const storageDeps = createRuntimeStorageDepsForTest({
    getWorkspaceSandbox: async () => ({
      sandbox: mockSandbox as any,
      cwd: "/tmp/nanthai-edge/chat_1",
    }),
  });

  const result = await importOwnedStorageFileToWorkspace(
    {
      userId: "user_1",
      chatId: "chat_1",
      ctx: createMockCtx({
        runQuery: async () => ({
          storageId: "storage_1",
          filename: "report.txt",
          mimeType: "text/plain",
          sizeBytes: 11,
          source: "upload",
        }),
        runMutation: async () => {},
        storage: {
          get: async () => new Blob(["hello world"], { type: "text/plain" }),
        },
      }),
    } as any,
    "storage_1",
    undefined,
    "nested/output.txt",
    storageDeps,
  );

  assert.deepEqual(makeDirCalls, ["/tmp/nanthai-edge/chat_1/nested"]);
  assert.equal(writeCalls[0]?.path, "/tmp/nanthai-edge/chat_1/nested/output.txt");
  assert.equal(result.path, "/tmp/nanthai-edge/chat_1/nested/output.txt");
  assert.equal(result.source, "upload");
  assert.ok(typeof result.note === "string");
});

test("exportWorkspaceFile requires a chatId", async () => {
  const ctx = createMockCtx({});

  await assert.rejects(
    () =>
      exportWorkspaceFile(
        {
          userId: "user_1",
          chatId: undefined,
          ctx,
        } as any,
        "/tmp/nanthai-edge/chat_1/outputs/report.md",
      ),
    (err: any) => {
      assert.ok(err.data?.message?.includes("chatId"));
      return true;
    },
  );
});

test("resetWorkspace returns a confirmation message when no sandbox is active", async () => {
  const ctx = createMockCtx({});

  const result = await resetWorkspace(
    {
      userId: "user_1",
      chatId: "chat_1",
      ctx,
    } as any,
  );

  assert.equal(result.chatId, "chat_1");
  assert.ok(typeof result.message === "string");
  assert.ok(result.message.includes("reset"));
});
