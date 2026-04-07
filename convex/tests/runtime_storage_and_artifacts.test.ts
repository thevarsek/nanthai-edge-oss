import assert from "node:assert/strict";
import test from "node:test";

import {
  createRuntimeServiceArtifactsDepsForTest,
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
  const writeCalls: Array<{ path: string; blob: Blob }> = [];
  const sandboxSession = {
    sessionId: "session_1",
    cwd: "/tmp/nanthai-edge/chat_1",
    sandbox: {
      files: {
        makeDir: async (path: string) => {
          makeDirCalls.push(path);
        },
        write: async (path: string, blob: Blob) => {
          writeCalls.push({ path, blob });
        },
      },
    },
  };
  const eventCalls: Record<string, unknown>[] = [];

  const storageDeps = createRuntimeStorageDepsForTest({
    ensureSandboxForChat: async () => sandboxSession as any,
    markSandboxSessionRunning: async () => undefined,
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
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          eventCalls.push(args);
        },
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
  assert.equal(eventCalls[0]?.eventType, "storage_file_imported");
});

test("exportWorkspaceFile prefers CONVEX_SITE_URL", async () => {
  process.env.CONVEX_SITE_URL = "https://edge.example";
  const mutationCalls: Record<string, unknown>[] = [];

  const blob = new Blob(["hi"], { type: "" });
  const exportSession = {
    sessionId: "session_export",
    cwd: "/tmp/nanthai-edge/chat_1",
    sandbox: {
      sandboxId: "sandbox_export",
      files: {
        read: async () => blob,
      },
    },
  };

  const artifactsDeps = createRuntimeServiceArtifactsDepsForTest({
    ensureSandboxForChat: async () => exportSession as any,
  });

  const ctx = createMockCtx({
    storage: {
      store: async () => "storage_1",
      getUrl: async () => "https://fallback.example/storage_1",
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
    },
  });

  const exported = await exportWorkspaceFile(
    {
      userId: "user_1",
      chatId: "chat_1",
      ctx,
    } as any,
    "/tmp/nanthai-edge/chat_1/outputs/report.md",
    undefined,
    artifactsDeps,
  );

  assert.equal(
    exported.downloadUrl,
    "https://edge.example/download?storageId=storage_1&filename=report.md",
  );
  assert.equal(exported.mimeType, "text/markdown");
  assert.equal(mutationCalls.length > 0, true);
  delete process.env.CONVEX_SITE_URL;
});

test("resetWorkspace recreates the sandbox after teardown errors", async () => {
  const recreatedSession = {
    sessionId: "session_new",
    cwd: "/tmp/nanthai-edge/chat_1",
    sandbox: {
      sandboxId: "sandbox_new",
      files: {},
    },
  };

  let ensureCalls = 0;
  const mutationCalls: Record<string, unknown>[] = [];

  const artifactsDeps = createRuntimeServiceArtifactsDepsForTest({
    ensureSandboxForChat: async () => {
      ensureCalls += 1;
      return recreatedSession as any;
    },
    ensureWorkspaceDirectories: async () => undefined as any,
    killE2BSandbox: async () => {
      throw new Error("sandbox already gone");
    },
  });

  const ctx = createMockCtx({
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
    },
    runQuery: async () => ({
      _id: "session_old",
      providerSandboxId: "sandbox_old",
      templateName: "tpl",
      templateVersion: "v1",
      cwd: "/tmp/nanthai-edge/chat_1",
      lastPausedAt: undefined,
      lastResumedAt: 10,
      lastHealthcheckAt: 10,
      timeoutMs: 1000,
      internetEnabled: true,
      publicTrafficEnabled: false,
      failureCount: 2,
      metadata: { keep: true },
    }),
  });

  const reset = await resetWorkspace(
    {
      userId: "user_1",
      chatId: "chat_1",
      ctx,
    } as any,
    artifactsDeps,
  );

  assert.equal(reset.sandboxId, "sandbox_new");
  assert.equal(ensureCalls, 1);
  assert.equal(mutationCalls.length, 2);
  assert.deepEqual(
    mutationCalls.map((call) => call.status),
    ["deleted", "running"],
  );
});
