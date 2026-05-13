import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { ConvexError } from "convex/values";
import { Sandbox } from "@vercel/sandbox";

import {
  exportPersistentRuntimeFile,
  getOrCreatePersistentRuntime,
  importOwnedStorageFileToPersistentRuntime,
  listPersistentRuntimeFiles,
  resetPersistentRuntime,
  resolvePersistentRuntimeWorkspacePath,
} from "../runtime/service_vm";

function withSandboxEnv() {
  const previous = {
    token: process.env.VERCEL_SANDBOX_TOKEN,
    projectId: process.env.VERCEL_SANDBOX_PROJECT_ID,
    teamId: process.env.VERCEL_SANDBOX_TEAM_ID,
  };
  process.env.VERCEL_SANDBOX_TOKEN = "token";
  process.env.VERCEL_SANDBOX_PROJECT_ID = "project";
  process.env.VERCEL_SANDBOX_TEAM_ID = "team";
  return () => {
    if (previous.token === undefined) delete process.env.VERCEL_SANDBOX_TOKEN;
    else process.env.VERCEL_SANDBOX_TOKEN = previous.token;
    if (previous.projectId === undefined) delete process.env.VERCEL_SANDBOX_PROJECT_ID;
    else process.env.VERCEL_SANDBOX_PROJECT_ID = previous.projectId;
    if (previous.teamId === undefined) delete process.env.VERCEL_SANDBOX_TEAM_ID;
    else process.env.VERCEL_SANDBOX_TEAM_ID = previous.teamId;
  };
}

function makeResult(stdout = "") {
  return {
    exitCode: 0,
    stdout: async () => stdout,
    stderr: async () => "",
  };
}

test("runtime workspace resolver rejects empty paths and allows root only when requested", () => {
  const root = "/tmp/nanthai-edge/chat_1/vm-python";

  assert.throws(
    () => resolvePersistentRuntimeWorkspacePath("   ", root),
    /must not be empty/i,
  );
  assert.equal(
    resolvePersistentRuntimeWorkspacePath(root, root, { allowRoot: true }),
    root,
  );
});

test("persistent VM reuses an active sandbox session and honors recursive listing", async () => {
  const restoreEnv = withSandboxEnv();
  const commands: Array<{ cmd: string; args: string[]; options?: unknown }> = [];
  const mutations: Array<Record<string, unknown>> = [];
  const extended: number[] = [];

  const sandbox = {
    sandboxId: "sbx_existing",
    extendTimeout: async (timeoutMs: number) => {
      extended.push(timeoutMs);
    },
    runCommand: async (cmd: string, args: string[], options?: unknown) => {
      commands.push({ cmd, args, options });
      const shell = args.join(" ");
      if (cmd === "bash" && shell.includes("find")) {
        return makeResult("f\t/tmp/nanthai-edge/chat_1/vm-python/outputs/report.txt\n");
      }
      return makeResult();
    },
  } as any;

  const createMock = mock.method(Sandbox, "create", async () => {
    throw new Error("new sandbox should not be created");
  });
  const getMock = mock.method(Sandbox, "get", async () => sandbox);
  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: {
      runQuery: async () => ({
        _id: "session_existing",
        provider: "vercel",
        status: "running",
        providerSandboxId: "sbx_existing",
      }),
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
        return "session_existing";
      },
    },
  } as any;

  const runtime = await getOrCreatePersistentRuntime(toolCtx, "python", 12_345);
  const listed = await listPersistentRuntimeFiles(
    toolCtx,
    "python",
    "/tmp/nanthai-edge/chat_1/vm-python/outputs",
    true,
  );

  assert.equal(runtime.sandbox.sandboxId, "sbx_existing");
  assert.deepEqual(extended, [12_345, 300_000]);
  assert.equal(getMock.mock.callCount(), 2);
  assert.equal(createMock.mock.callCount(), 0);
  assert.equal(mutations[0].sessionId, "session_existing");
  assert.equal(mutations[0].providerSandboxId, "sbx_existing");
  assert.equal(toolCtx.sandboxSessionId, "session_existing");
  assert.equal(listed.root, "/tmp/nanthai-edge/chat_1/vm-python/outputs");
  assert.deepEqual(listed.files, [
    {
      name: "report.txt",
      path: "/tmp/nanthai-edge/chat_1/vm-python/outputs/report.txt",
      type: "file",
    },
  ]);
  assert.ok(
    commands.some(
      (entry) =>
        entry.args.join(" ").includes("find '/tmp/nanthai-edge/chat_1/vm-python/outputs'") &&
        !entry.args.join(" ").includes("-maxdepth 1"),
    ),
  );

  createMock.mock.restore();
  getMock.mock.restore();
  restoreEnv();
});

test("persistent VM storage import uses safe filename defaults and absolute targets", async () => {
  const restoreEnv = withSandboxEnv();
  const writes: Array<Array<Record<string, unknown>>> = [];
  const sandbox = {
    sandboxId: "sbx_import",
    runCommand: async () => makeResult(),
    writeFiles: async (files: Array<Record<string, unknown>>) => {
      writes.push(files);
    },
  } as any;
  const createMock = mock.method(Sandbox, "create", async () => sandbox);
  const getMock = mock.method(Sandbox, "get", async () => {
    throw new Error("no running session");
  });
  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: {
      runQuery: async (_fn: unknown, args: Record<string, unknown>) => ({
        storageId: args.storageId,
        filename: "Unsafe Notes (Draft).txt",
        mimeType: undefined,
        sizeBytes: undefined,
        source: "upload",
      }),
      runMutation: async () => "session_import",
      storage: {
        get: async () => new Blob(["payload"], { type: "text/plain" }),
      },
    },
  } as any;

  const defaultImport = await importOwnedStorageFileToPersistentRuntime(
    toolCtx,
    "python",
    "storage_default",
  );
  const absoluteImport = await importOwnedStorageFileToPersistentRuntime(
    toolCtx,
    "python",
    "storage_absolute",
    "explicit.txt",
    "/tmp/nanthai-edge/chat_1/vm-python/outputs/explicit.txt",
  );

  assert.equal(
    defaultImport.path,
    "/tmp/nanthai-edge/chat_1/vm-python/inputs/Unsafe_Notes_Draft_.txt",
  );
  assert.equal(defaultImport.mimeType, "text/plain");
  assert.equal(defaultImport.sizeBytes, 7);
  assert.equal(
    absoluteImport.path,
    "/tmp/nanthai-edge/chat_1/vm-python/outputs/explicit.txt",
  );
  assert.equal(absoluteImport.filename, "explicit.txt");
  assert.ok(writes.some((batch) => String(batch[0].path).endsWith("explicit.txt")));

  createMock.mock.restore();
  getMock.mock.restore();
  restoreEnv();
});

test("persistent VM export and reset surface actionable failures before side effects", async () => {
  const restoreEnv = withSandboxEnv();
  const sandbox = {
    sandboxId: "sbx_failures",
    runCommand: async () => makeResult(),
    readFileToBuffer: async () => null,
  } as any;
  const createMock = mock.method(Sandbox, "create", async () => sandbox);
  const getMock = mock.method(Sandbox, "get", async () => {
    throw new Error("no running session");
  });
  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: {
      runQuery: async () => null,
      runMutation: async () => "session_failures",
    },
  } as any;

  await assert.rejects(
    () =>
      exportPersistentRuntimeFile(
        toolCtx,
        "python",
        "/tmp/nanthai-edge/chat_1/vm-python/outputs/missing.csv",
      ),
    (err) =>
      err instanceof ConvexError &&
      err.data.code === "NOT_FOUND" &&
      /missing.csv/.test(err.data.message),
  );
  await assert.rejects(
    () => resetPersistentRuntime({ ...toolCtx, chatId: undefined }, "python"),
    (err) =>
      err instanceof ConvexError &&
      err.data.code === "INTERNAL_ERROR" &&
      /require chatId/i.test(err.data.message),
  );

  createMock.mock.restore();
  getMock.mock.restore();
  restoreEnv();
});
