import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { Sandbox } from "@vercel/sandbox";

import { dataPythonExec } from "../tools/data_python_exec";
import { dataPythonSandbox } from "../tools/data_python_sandbox";
import { generatePdf } from "../tools/generate_pdf";
import { readPdf } from "../tools/read_pdf";
import { spawnSubagents } from "../tools/spawn_subagents";
import { vmExec } from "../tools/vm_exec";
import { vmDeleteFile } from "../tools/vm_delete_file";
import { vmExportFile } from "../tools/vm_export_file";
import { vmImportFile } from "../tools/vm_import_file";
import { vmListFiles } from "../tools/vm_list_files";
import { vmMakeDirs } from "../tools/vm_make_dirs";
import { vmReadFile } from "../tools/vm_read_file";
import { vmReset } from "../tools/vm_reset";
import { parseVmEnvironment } from "../tools/vm_shared";
import { vmWriteFile } from "../tools/vm_write_file";

test("data python tools reject missing code", async () => {
  const execResult = await dataPythonExec.execute({} as any, {});
  const sandboxResult = await dataPythonSandbox.execute({} as any, {});

  assert.equal(execResult.success, false);
  assert.equal(execResult.error, "Missing code.");
  assert.equal(sandboxResult.success, false);
  assert.equal(sandboxResult.error, "Missing code.");
});

test("data python tools surface runtime context errors through execute wrappers", async () => {
  const execResult = await dataPythonExec.execute(
    { userId: "user_1" } as any,
    { code: "print(1)" },
  );
  const sandboxResult = await dataPythonSandbox.execute(
    { userId: "user_1" } as any,
    { code: "print(1)" },
  );

  assert.equal(execResult.success, false);
  assert.match(String(execResult.error), /require chatId/i);
  assert.equal(sandboxResult.success, false);
  assert.match(String(sandboxResult.error), /require chatId/i);
});

test("data python exec ignores malformed inputFiles entries before runtime execution", async () => {
  const execResult = await dataPythonExec.execute(
    { userId: "user_1" } as any,
    {
      code: "print(1)",
      inputFiles: [null, "bad entry", { filename: "missing-storage.csv" }],
    },
  );

  assert.equal(execResult.success, false);
  assert.match(String(execResult.error), /require chatId/i);
});

test("persistent runtime wrappers validate required args", async () => {
  const vmResult = await vmExec.execute({} as any, {});
  const readResult = await readPdf.execute({} as any, {});
  const vmReadResult = await vmReadFile.execute({} as any, {});
  const vmWriteResult = await vmWriteFile.execute({} as any, { content: "hello" });
  const vmDeleteResult = await vmDeleteFile.execute({} as any, {});
  const vmMakeDirsResult = await vmMakeDirs.execute({} as any, {});
  const vmImportResult = await vmImportFile.execute({} as any, {});
  const vmExportResult = await vmExportFile.execute({} as any, {});
  const vmResetResult = await vmReset.execute({} as any, { confirm: false });
  const generateResult = await generatePdf.execute({} as any, {
    title: "Quarterly Report",
    sections: [],
  });

  assert.equal(vmResult.success, false);
  assert.equal(vmResult.error, "Missing command.");
  assert.equal(readResult.success, false);
  assert.equal(readResult.error, "Missing storageId.");
  assert.equal(vmReadResult.error, "Missing path.");
  assert.equal(vmWriteResult.error, "Missing path.");
  assert.equal(vmDeleteResult.error, "Missing path.");
  assert.equal(vmMakeDirsResult.error, "Missing path.");
  assert.equal(vmImportResult.error, "Missing storageId.");
  assert.equal(vmExportResult.error, "Missing path.");
  assert.equal(vmResetResult.error, "Set confirm=true to reset the persistent runtime workspace.");
  assert.equal(generateResult.success, false);
  assert.equal(generateResult.error, "Provide at least one section.");
});

test("persistent VM wrappers surface context errors and normalize environment selection", async () => {
  const toolCtx = { userId: "user_1" } as any;
  const results = await Promise.all([
    vmReadFile.execute(toolCtx, { environment: "node", path: "/tmp/readme.txt" }),
    vmWriteFile.execute(toolCtx, { path: "/tmp/readme.txt", content: "hello", overwrite: true }),
    vmListFiles.execute(toolCtx, { environment: "unexpected", recursive: true }),
    vmDeleteFile.execute(toolCtx, { path: "/tmp/readme.txt" }),
    vmMakeDirs.execute(toolCtx, { path: "/tmp/reports" }),
    vmImportFile.execute(toolCtx, { storageId: "storage_1", filename: "source.txt" }),
    vmExportFile.execute(toolCtx, { path: "/tmp/report.txt", filename: "report.txt" }),
    vmReset.execute(toolCtx, { environment: "node", confirm: true }),
  ]);

  for (const result of results) {
    assert.equal(result.success, false);
    assert.match(String(result.error), /require chatId/i);
  }
  assert.equal(parseVmEnvironment("node"), "node");
  assert.equal(parseVmEnvironment("python"), "python");
  assert.equal(parseVmEnvironment("ruby"), "python");
  assert.equal(parseVmEnvironment(undefined), "python");
});

test("persistent VM wrappers execute successful filesystem workflows through the public tool API", async () => {
  const previousEnv = {
    token: process.env.VERCEL_SANDBOX_TOKEN,
    project: process.env.VERCEL_SANDBOX_PROJECT_ID,
    team: process.env.VERCEL_SANDBOX_TEAM_ID,
    siteUrl: process.env.CONVEX_SITE_URL,
  };
  process.env.VERCEL_SANDBOX_TOKEN = "token";
  process.env.VERCEL_SANDBOX_PROJECT_ID = "project";
  process.env.VERCEL_SANDBOX_TEAM_ID = "team";
  delete process.env.CONVEX_SITE_URL;

  const commands: Array<{ cmd: string; args: string[] }> = [];
  const writes: Array<Array<Record<string, unknown>>> = [];
  const stored: Blob[] = [];
  const mutations: Array<Record<string, unknown>> = [];
  const sandbox = {
    sandboxId: "sandbox_1",
    runCommand: async (cmd: string, args: string[]) => {
      commands.push({ cmd, args });
      if (cmd === "bash" && args.join(" ").includes("find")) {
        return {
          exitCode: 0,
          stdout: async () => "d\t/tmp/nanthai-edge/chat_1/vm-node/outputs\nf\t/tmp/nanthai-edge/chat_1/vm-node/outputs/report.txt\n",
          stderr: async () => "",
        };
      }
      return { exitCode: 0, stdout: async () => "ok", stderr: async () => "" };
    },
    readFileToBuffer: async ({ path }: { path: string }) => {
      if (path.endsWith("missing.txt")) return null;
      if (path.endsWith("image.png")) return Buffer.from([137, 80, 78, 71]);
      if (path.endsWith("existing.txt")) return Buffer.from("old");
      if (path.endsWith("export.txt")) return Buffer.from("exported");
      return Buffer.from("hello world");
    },
    writeFiles: async (files: Array<Record<string, unknown>>) => {
      writes.push(files);
    },
  } as any;
  const createMock = mock.method(Sandbox, "create", async () => sandbox);
  const getMock = mock.method(Sandbox, "get", async () => sandbox);

  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: {
      runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
        if (args.storageId) {
          return {
            storageId: args.storageId,
            filename: "Notes.txt",
            mimeType: "text/plain",
            sizeBytes: 5,
            source: "upload",
          };
        }
        return null;
      },
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
        return "session_1";
      },
      storage: {
        get: async () => new Blob(["notes"], { type: "text/plain" }),
        store: async (blob: Blob) => {
          stored.push(blob);
          return "stored_1";
        },
        getUrl: async (id: string) => `https://files.example/${id}`,
      },
    },
  } as any;

  try {
    const exec = await vmExec.execute(toolCtx, {
      environment: "node",
      command: "node -e 'console.log(1)'",
      cwd: "/tmp/nanthai-edge/chat_1/vm-node",
      timeoutMs: 1000,
    });
    const listed = await vmListFiles.execute(toolCtx, { environment: "node" });
    const textRead = await vmReadFile.execute(toolCtx, {
      environment: "node",
      path: "/tmp/nanthai-edge/chat_1/vm-node/outputs/report.txt",
      maxBytes: 5,
    });
    const binaryRead = await vmReadFile.execute(toolCtx, {
      environment: "node",
      path: "/tmp/nanthai-edge/chat_1/vm-node/outputs/image.png",
    });
    const missingRead = await vmReadFile.execute(toolCtx, {
      environment: "node",
      path: "/tmp/nanthai-edge/chat_1/vm-node/outputs/missing.txt",
    });
    const conflict = await vmWriteFile.execute(toolCtx, {
      environment: "node",
      path: "/tmp/nanthai-edge/chat_1/vm-node/outputs/existing.txt",
      content: "new",
    });
    const replaced = await vmWriteFile.execute(toolCtx, {
      environment: "node",
      path: "/tmp/nanthai-edge/chat_1/vm-node/outputs/new.txt",
      content: "new",
      overwrite: true,
    });
    const made = await vmMakeDirs.execute(toolCtx, { environment: "node", path: "outputs/nested" });
    const imported = await vmImportFile.execute(toolCtx, {
      environment: "node",
      storageId: "storage_1",
      targetPath: "inputs/notes.txt",
    });
    const exported = await vmExportFile.execute(toolCtx, {
      environment: "node",
      path: "/tmp/nanthai-edge/chat_1/vm-node/outputs/export.txt",
    });
    const deleted = await vmDeleteFile.execute(toolCtx, {
      environment: "node",
      path: "outputs/old.txt",
    });
    const reset = await vmReset.execute(toolCtx, { environment: "node", confirm: true });

    assert.equal(exec.success, true);
    assert.equal((exec.data as any).stdout, "ok");
    assert.equal(listed.success, true);
    assert.equal((listed.data as any).files[1].name, "report.txt");
    assert.equal((textRead.data as any).content, "hello");
    assert.equal((textRead.data as any).truncated, true);
    assert.equal((binaryRead.data as any).isBinary, true);
    assert.equal((missingRead.data as any).content, null);
    assert.equal(conflict.success, false);
    assert.match(String(conflict.error), /overwrite=false/);
    assert.equal(replaced.success, true);
    assert.equal((replaced.data as any).bytesWritten, 3);
    assert.equal((made.data as any).created, true);
    assert.equal((imported.data as any).path, "/tmp/nanthai-edge/chat_1/vm-node/inputs/notes.txt");
    assert.equal(exported.success, true);
    assert.equal((exported.data as any).storageId, "stored_1");
    assert.equal((deleted.data as any).deleted, true);
    assert.equal((reset.data as any).environment, "node");
    assert.ok(commands.some((entry) => entry.args.join(" ").includes("node -e")));
    assert.ok(writes.some((batch) => String(batch[0].path).endsWith("inputs/notes.txt")));
    assert.equal(stored.length, 1);
    assert.ok(mutations.some((args) => args.storageId === "stored_1"));
  } finally {
    createMock.mock.restore();
    getMock.mock.restore();
    if (previousEnv.token === undefined) delete process.env.VERCEL_SANDBOX_TOKEN;
    else process.env.VERCEL_SANDBOX_TOKEN = previousEnv.token;
    if (previousEnv.project === undefined) delete process.env.VERCEL_SANDBOX_PROJECT_ID;
    else process.env.VERCEL_SANDBOX_PROJECT_ID = previousEnv.project;
    if (previousEnv.team === undefined) delete process.env.VERCEL_SANDBOX_TEAM_ID;
    else process.env.VERCEL_SANDBOX_TEAM_ID = previousEnv.team;
    if (previousEnv.siteUrl === undefined) delete process.env.CONVEX_SITE_URL;
    else process.env.CONVEX_SITE_URL = previousEnv.siteUrl;
  }
});

test("spawnSubagents validates tasks and returns deferred payload for valid requests", async () => {
  const invalid = await spawnSubagents.execute({} as any, {
    tasks: [{ title: "only title" }],
  } as any);

  const valid = await spawnSubagents.execute({} as any, {
    tasks: [
      { title: "Research", prompt: "Compare the two API options." },
      { title: "Review", prompt: "Check the migration plan for risks." },
    ],
  });

  assert.equal(invalid.success, false);
  assert.match(String(invalid.error), /Provide between 1 and 3 tasks/);
  assert.equal(valid.success, true);
  assert.deepEqual(valid.deferred, {
    kind: "spawn_subagents",
    data: {
      tasks: [
        { title: "Research", prompt: "Compare the two API options." },
        { title: "Review", prompt: "Check the migration plan for risks." },
      ],
    },
  });
});
