import assert from "node:assert/strict";
import test from "node:test";

import {
  listFilesInSandbox,
  makeDirInSandbox,
  readFileInSandbox,
  runCommandInSandbox,
  writeFileInSandbox,
  writeFilesToSandbox,
} from "../runtime/justbash_client";
import { sanitizeFilename } from "../tools/sanitize";
import { ToolRegistry } from "../tools/registry";
import {
  registerAnalyticsTools,
  registerPersistentRuntimeTools,
  registerWorkspaceProfileTools,
  registerWorkspaceTools,
} from "../tools/workspace_registry";
import { workspaceExec } from "../tools/workspace_exec";
import { workspaceExportFile } from "../tools/workspace_export_file";
import { workspaceImportFile } from "../tools/workspace_import_file";
import { workspaceListFiles } from "../tools/workspace_list_files";
import { workspaceMakeDirs } from "../tools/workspace_make_dirs";
import { workspaceReadFile } from "../tools/workspace_read_file";
import { workspaceReset } from "../tools/workspace_reset";
import { workspaceWriteFile } from "../tools/workspace_write_file";

test("runtime just-bash helpers wrap command execution, listing, truncation, and writes", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const sandbox = {
    runCommand: async (params: Record<string, unknown>) => {
      calls.push(params);
      const command = (params.args as string[])[1];
      if (command.includes("-type d")) {
        return { exitCode: 0, stdout: async () => "/tmp/root/src\n", stderr: async () => "" };
      }
      if (command.includes("-type f")) {
        return { exitCode: 0, stdout: async () => "/tmp/root/src/index.ts\n", stderr: async () => "" };
      }
      return { exitCode: 3, stdout: async () => "ok", stderr: async () => "warn" };
    },
    readFile: async (_path: string, _encoding: string) => "ab🙂cd",
    writeFiles: async (_files: Record<string, unknown>) => {},
    mkDir: async (_path: string, _opts: Record<string, unknown>) => {},
  } as any;

  const commandResult = await runCommandInSandbox(sandbox, "echo hello", { cwd: "/tmp/root" });
  const listResult = await listFilesInSandbox(sandbox, "/tmp/root", { recursive: true });
  const readResult = await readFileInSandbox(sandbox, "/tmp/root/file.txt", 4);
  const writeResult = await writeFileInSandbox(sandbox, "/tmp/root/file.txt", "hello");
  await writeFilesToSandbox(sandbox, { "/tmp/root/data.json": "{}" });
  const mkdirResult = await makeDirInSandbox(sandbox, "/tmp/root/new");

  assert.equal(commandResult.exitCode, 3);
  assert.equal(commandResult.stdout, "ok");
  assert.equal(commandResult.stderr, "warn");
  assert.deepEqual(calls[0], {
    cmd: "bash",
    args: ["-c", "echo hello"],
    cwd: "/tmp/root",
    signal: undefined,
  });
  assert.deepEqual(listResult, [
    { name: "src", path: "/tmp/root/src", type: "dir" },
    { name: "index.ts", path: "/tmp/root/src/index.ts", type: "file" },
  ]);
  assert.deepEqual(readResult, { content: "ab", sizeBytes: 8, truncated: true });
  assert.deepEqual(writeResult, { path: "/tmp/root/file.txt", bytesWritten: 5 });
  assert.deepEqual(mkdirResult, { path: "/tmp/root/new", created: true });
});

test("workspace registry helpers register the expected tool sets and sanitize filenames", () => {
  const analytics = new ToolRegistry();
  const profile = new ToolRegistry();
  const persistent = new ToolRegistry();
  const full = new ToolRegistry();

  registerAnalyticsTools(analytics);
  registerWorkspaceProfileTools(profile);
  registerPersistentRuntimeTools(persistent);
  registerWorkspaceTools(full);

  assert.ok(analytics.get("workspace_import_file"));
  assert.ok(analytics.get("data_python_exec"));
  assert.equal(analytics.get("workspace_exec"), undefined);
  assert.ok(profile.get("workspace_exec"));
  assert.ok(profile.get("workspace_reset"));
  assert.equal(profile.get("data_python_exec"), undefined);
  assert.ok(persistent.get("vm_exec"));
  assert.ok(persistent.get("read_pdf"));
  assert.equal(persistent.get("workspace_exec"), undefined);
  assert.ok(full.get("workspace_exec"));
  assert.ok(full.get("data_python_sandbox"));
  assert.equal(sanitizeFilename(" Q1: Plan?.pptx "), "Q1_Plan_pptx");
});

test("workspace tool wrappers validate args and use the shared sandbox/runtime services", async () => {
  const stored: Blob[] = [];
  const mutations: Array<Record<string, unknown>> = [];
  const writes: Array<Record<string, unknown>> = [];
  const sandbox = {
    runCommand: async () => ({ exitCode: 0, stdout: async () => "done", stderr: async () => "" }),
    readFile: async (path: string, encoding: string) => {
      if (path === "/workspace/existing.txt") return "already here";
      if (encoding === "base64") return Buffer.from("png").toString("base64");
      return "exported text";
    },
    writeFiles: async (files: Record<string, unknown>) => {
      writes.push(files);
    },
    mkDir: async (_path: string, _opts: Record<string, unknown>) => {},
    stop: async () => {},
  } as any;
  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    workspaceSandbox: sandbox,
    ctx: {
      runQuery: async () => ({
        storageId: "storage_1",
        filename: "notes.txt",
        mimeType: "text/plain",
        source: "upload",
      }),
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
      storage: {
        get: async () => new Blob(["hello"], { type: "text/plain" }),
        store: async (blob: Blob) => {
          stored.push(blob);
          return "stored_1";
        },
        getUrl: async () => "https://files.example/stored_1",
      },
    },
  } as any;

  const missingExec = await workspaceExec.execute(toolCtx, {});
  const execResult = await workspaceExec.execute(toolCtx, { command: "pwd" });
  const writeConflict = await workspaceWriteFile.execute(toolCtx, {
    path: "/workspace/existing.txt",
    content: "new",
  });
  const listResult = await workspaceListFiles.execute(toolCtx, {
    path: "/workspace",
    recursive: true,
  });
  const mkdirRejected = await workspaceMakeDirs.execute(toolCtx, { path: "   " });
  const mkdirResult = await workspaceMakeDirs.execute(toolCtx, { path: "/workspace/new-dir" });
  const binaryRead = await workspaceReadFile.execute(toolCtx, { path: "/workspace/image.png" });
  const imported = await workspaceImportFile.execute(toolCtx, { storageId: "storage_1" });
  const exported = await workspaceExportFile.execute(toolCtx, {
    path: "/workspace/chart.png",
    filename: "chart.png",
  });
  const resetRejected = await workspaceReset.execute(toolCtx, { confirm: false });
  const resetNoSandbox = await workspaceReset.execute({ ...toolCtx, workspaceSandbox: undefined }, { confirm: true });

  assert.equal(missingExec.success, false);
  assert.equal(execResult.success, true);
  assert.equal((execResult.data as any).stdout, "done");
  assert.equal(writeConflict.success, false);
  assert.match(String(writeConflict.error), /overwrite=true/);
  assert.equal(listResult.success, true);
  assert.equal((listResult.data as any).root, "/workspace");
  assert.ok((listResult.data as any).files.length >= 0);
  assert.equal(mkdirRejected.success, false);
  assert.equal(mkdirResult.success, true);
  assert.equal((mkdirResult.data as any).path, "/workspace/new-dir");
  assert.equal(binaryRead.success, true);
  assert.equal((binaryRead.data as any).isBinary, true);
  assert.equal(imported.success, true);
  assert.equal((imported.data as any).path, "/tmp/nanthai-edge/chat_1/inputs/notes.txt");
  assert.deepEqual(writes, [{ "/tmp/nanthai-edge/chat_1/inputs/notes.txt": "hello" }]);
  assert.equal(exported.success, true);
  assert.equal((exported.data as any).storageId, "stored_1");
  assert.equal(stored.length, 1);
  assert.equal(mutations.length, 1);
  assert.equal(resetRejected.success, false);
  assert.equal(resetNoSandbox.success, true);
});
