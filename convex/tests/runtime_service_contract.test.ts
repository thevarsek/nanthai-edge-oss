import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { Sandbox } from "@e2b/code-interpreter";

import { createMockCtx } from "../../test_helpers/convex_mock_ctx";
import {
  ensureSandboxForChat,
  listWorkspaceFiles,
  makeWorkspaceDirs,
  readWorkspaceFile,
  runWorkspaceCommand,
  writeWorkspaceFile,
} from "../runtime/service";

test("ensureSandboxForChat rejects tool contexts without chatId", async () => {
  await assert.rejects(
    () => ensureSandboxForChat({ userId: "user_1", ctx: createMockCtx({}) } as any),
    /require chatId/i,
  );
});

function createExistingToolCtx(existingOverrides: Record<string, unknown> = {}) {
  const existing = {
    _id: "session_existing",
    providerSandboxId: "sandbox_existing",
    status: "paused",
    cwd: "/tmp/nanthai-edge/chat_1",
    templateName: "nanthai-runtime",
    templateVersion: "1",
    lastPausedAt: 1,
    timeoutMs: 600_000,
    internetEnabled: true,
    publicTrafficEnabled: false,
    failureCount: 0,
    metadata: { source: "test" },
    ...existingOverrides,
  };
  const mutations: Record<string, unknown>[] = [];
  return {
    existing,
    mutations,
    toolCtx: {
      userId: "user_1",
      chatId: "chat_1",
      ctx: {
        runQuery: async () => existing,
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          mutations.push(args);
          return args.sessionId ?? "session_new";
        },
      },
    } as any,
  };
}

test("ensureSandboxForChat reconnects healthy sandboxes and refreshes session state", async (t) => {
  t.after(() => {
    mock.restoreAll();
    process.env.E2B_API_KEY = "test-key";
  });

  process.env.E2B_API_KEY = "test-key";
  const setTimeoutCalls: number[] = [];
  const commandCalls: Array<{ command: string; timeoutMs?: number }> = [];
  const { toolCtx, mutations } = createExistingToolCtx();

  mock.method(Sandbox, "connect", async (sandboxId: string) => {
    assert.equal(sandboxId, "sandbox_existing");
    return {
      sandboxId,
      setTimeout: async (value: number) => {
        setTimeoutCalls.push(value);
      },
      commands: {
        run: async (command: string, options?: { timeoutMs?: number }) => {
          commandCalls.push({ command, timeoutMs: options?.timeoutMs });
          return { stdout: "runtime_ready", stderr: "", exitCode: 0 };
        },
      },
    } as any;
  });

  const result = await ensureSandboxForChat(toolCtx);

  assert.equal(result.sessionId, "session_existing");
  assert.equal(result.cwd, "/tmp/nanthai-edge/chat_1");
  assert.deepEqual(setTimeoutCalls, [300_000]);
  assert.deepEqual(commandCalls, [{ command: "echo runtime_ready", timeoutMs: 5_000 }]);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0]?.status, "running");
  assert.equal(mutations[0]?.providerSandboxId, "sandbox_existing");
});

test("ensureSandboxForChat recreates unhealthy sandboxes and records reconnect failure", async (t) => {
  t.after(() => {
    mock.restoreAll();
    process.env.E2B_API_KEY = "test-key";
  });

  process.env.E2B_API_KEY = "test-key";
  const createdDirs: string[] = [];
  const mutations: Record<string, unknown>[] = [];
  const existing = {
    _id: "session_existing",
    providerSandboxId: "sandbox_broken",
    status: "running",
    cwd: "/tmp/nanthai-edge/chat_1",
    templateName: "nanthai-runtime",
    templateVersion: "1",
    timeoutMs: 600_000,
    internetEnabled: true,
    publicTrafficEnabled: false,
    failureCount: 2,
    metadata: { source: "test" },
  };

  mock.method(Sandbox, "connect", async () => ({
    sandboxId: "sandbox_broken",
    setTimeout: async () => undefined,
    commands: {
      run: async () => {
        throw new Error("healthcheck failed");
      },
    },
  }) as any);
  mock.method(Sandbox, "create", async () => ({
    sandboxId: "sandbox_new",
    files: {
      makeDir: async (path: string) => {
        createdDirs.push(path);
        return true;
      },
    },
  }) as any);

  const result = await ensureSandboxForChat({
    userId: "user_1",
    chatId: "chat_1",
    ctx: {
      runQuery: async () => existing,
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
        return "session_existing";
      },
    },
  } as any);

  assert.equal(result.sessionId, "session_existing");
  assert.equal((result.sandbox as any).sandboxId, "sandbox_new");
  assert.deepEqual(createdDirs, [
    "/tmp/nanthai-edge/chat_1",
    "/tmp/nanthai-edge/chat_1/inputs",
    "/tmp/nanthai-edge/chat_1/outputs",
    "/tmp/nanthai-edge/chat_1/charts",
  ]);
  assert.equal(mutations[0]?.eventType, "sandbox_reconnect_failed");
  assert.equal(mutations[1]?.providerSandboxId, "sandbox_new");
  assert.equal(mutations[2]?.eventType, "sandbox_recreated");
});

test("runWorkspaceCommand uses default cwd and timeout and marks the session running", async (t) => {
  t.after(() => {
    mock.restoreAll();
    process.env.E2B_API_KEY = "test-key";
  });

  process.env.E2B_API_KEY = "test-key";
  const calls: Array<{ command: string; cwd?: string; timeoutMs?: number }> = [];
  const { toolCtx, mutations } = createExistingToolCtx();

  mock.method(Sandbox, "connect", async () => ({
    sandboxId: "sandbox_existing",
    setTimeout: async () => undefined,
    commands: {
      run: async (command: string, options?: { cwd?: string; timeoutMs?: number }) => {
        calls.push({ command, cwd: options?.cwd, timeoutMs: options?.timeoutMs });
        return { stdout: "ok", stderr: "", exitCode: 0 };
      },
    },
  }) as any);

  const result = await runWorkspaceCommand(toolCtx, "ls -la");

  assert.equal(result.cwd, "/tmp/nanthai-edge/chat_1");
  assert.equal(result.stdout, "ok");
  assert.deepEqual(calls.at(-1), {
    command: "ls -la",
    cwd: "/tmp/nanthai-edge/chat_1",
    timeoutMs: 60_000,
  });
  assert.equal(mutations.at(-1)?.status, "running");
});

test("listWorkspaceFiles recursively flattens child directories", async (t) => {
  t.after(() => {
    mock.restoreAll();
    process.env.E2B_API_KEY = "test-key";
  });

  process.env.E2B_API_KEY = "test-key";
  const { toolCtx } = createExistingToolCtx();
  const listCalls: string[] = [];

  mock.method(Sandbox, "connect", async () => ({
    sandboxId: "sandbox_existing",
    setTimeout: async () => undefined,
    commands: {
      run: async () => ({ stdout: "runtime_ready", stderr: "", exitCode: 0 }),
    },
    files: {
      list: async (path: string) => {
        listCalls.push(path);
        if (path === "/tmp/nanthai-edge/chat_1") {
          return [
            { path: "/tmp/nanthai-edge/chat_1/file.txt", type: "file" },
            { path: "/tmp/nanthai-edge/chat_1/subdir", type: "dir" },
          ];
        }
        return [{ path: "/tmp/nanthai-edge/chat_1/subdir/nested.txt", type: "file" }];
      },
    },
  }) as any);

  const result = await listWorkspaceFiles(toolCtx, undefined, true);

  assert.deepEqual(listCalls, [
    "/tmp/nanthai-edge/chat_1",
    "/tmp/nanthai-edge/chat_1/subdir",
  ]);
  assert.equal(result.root, "/tmp/nanthai-edge/chat_1");
  assert.equal(result.files.length, 3);
});

test("readWorkspaceFile returns truncated text and warns on binary files", async (t) => {
  t.after(() => {
    mock.restoreAll();
    process.env.E2B_API_KEY = "test-key";
  });

  process.env.E2B_API_KEY = "test-key";
  const { toolCtx } = createExistingToolCtx();

  mock.method(Sandbox, "connect", async () => ({
    sandboxId: "sandbox_existing",
    setTimeout: async () => undefined,
    commands: {
      run: async () => ({ stdout: "runtime_ready", stderr: "", exitCode: 0 }),
    },
    files: {
      read: async (path: string) => {
        if (path.endsWith(".png")) {
          return Uint8Array.from([0, 1, 2, 3]);
        }
        return new TextEncoder().encode("abcdef");
      },
    },
  }) as any);

  const text = await readWorkspaceFile(toolCtx, "/tmp/nanthai-edge/chat_1/report.md", 3);
  const binary = await readWorkspaceFile(toolCtx, "/tmp/nanthai-edge/chat_1/image.png");

  assert.equal(text.content, "abc");
  assert.equal(text.truncated, true);
  assert.equal(binary.isBinary, true);
  assert.match(String(binary.error), /binary/);
});

test("writeWorkspaceFile guards overwrite and makeWorkspaceDirs forwards directory creation", async (t) => {
  t.after(() => {
    mock.restoreAll();
    process.env.E2B_API_KEY = "test-key";
  });

  process.env.E2B_API_KEY = "test-key";
  const writes: Array<{ path: string; content: string }> = [];
  const dirs: string[] = [];
  const { toolCtx } = createExistingToolCtx();

  mock.method(Sandbox, "connect", async () => ({
    sandboxId: "sandbox_existing",
    setTimeout: async () => undefined,
    commands: {
      run: async () => ({ stdout: "runtime_ready", stderr: "", exitCode: 0 }),
    },
    files: {
      exists: async (path: string) => path.endsWith("existing.txt"),
      write: async (path: string, content: string) => {
        writes.push({ path, content });
      },
      makeDir: async (path: string) => {
        dirs.push(path);
        return true;
      },
    },
  }) as any);

  await assert.rejects(
    () =>
      writeWorkspaceFile(
        toolCtx,
        "/tmp/nanthai-edge/chat_1/existing.txt",
        "hello",
        false,
      ),
    /overwrite=true/,
  );

  const writeResult = await writeWorkspaceFile(
    toolCtx,
    "/tmp/nanthai-edge/chat_1/new.txt",
    "hello",
    true,
  );
  const dirResult = await makeWorkspaceDirs(toolCtx, "/tmp/nanthai-edge/chat_1/new-dir");

  assert.deepEqual(writes, [{
    path: "/tmp/nanthai-edge/chat_1/new.txt",
    content: "hello",
  }]);
  assert.equal(writeResult.bytesWritten, 5);
  assert.deepEqual(dirs, ["/tmp/nanthai-edge/chat_1/new-dir"]);
  assert.deepEqual(dirResult, {
    path: "/tmp/nanthai-edge/chat_1/new-dir",
    created: true,
  });
});
