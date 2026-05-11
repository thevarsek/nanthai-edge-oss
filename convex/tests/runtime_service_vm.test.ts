import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { Sandbox } from "@vercel/sandbox";

import { generatePdfDocument, readPdfBlob } from "../runtime/service_pdf";
import {
  deletePersistentRuntimePath,
  exportPersistentRuntimeFile,
  importOwnedStorageFileToPersistentRuntime,
  listPersistentRuntimeFiles,
  makePersistentRuntimeDirs,
  readPersistentRuntimeFile,
  resetPersistentRuntime,
  resolvePersistentRuntimeWorkspacePath,
  writePersistentRuntimeFile,
} from "../runtime/service_vm";

function withSandboxEnv() {
  const previous = {
    token: process.env.VERCEL_SANDBOX_TOKEN,
    projectId: process.env.VERCEL_SANDBOX_PROJECT_ID,
    teamId: process.env.VERCEL_SANDBOX_TEAM_ID,
    siteUrl: process.env.CONVEX_SITE_URL,
  };
  process.env.VERCEL_SANDBOX_TOKEN = "token";
  process.env.VERCEL_SANDBOX_PROJECT_ID = "project";
  process.env.VERCEL_SANDBOX_TEAM_ID = "team";
  delete process.env.CONVEX_SITE_URL;
  return () => {
    if (previous.token === undefined) delete process.env.VERCEL_SANDBOX_TOKEN;
    else process.env.VERCEL_SANDBOX_TOKEN = previous.token;
    if (previous.projectId === undefined) delete process.env.VERCEL_SANDBOX_PROJECT_ID;
    else process.env.VERCEL_SANDBOX_PROJECT_ID = previous.projectId;
    if (previous.teamId === undefined) delete process.env.VERCEL_SANDBOX_TEAM_ID;
    else process.env.VERCEL_SANDBOX_TEAM_ID = previous.teamId;
    if (previous.siteUrl === undefined) delete process.env.CONVEX_SITE_URL;
    else process.env.CONVEX_SITE_URL = previous.siteUrl;
  };
}

test("resolvePersistentRuntimeWorkspacePath resolves relative paths inside the workspace", () => {
  const resolved = resolvePersistentRuntimeWorkspacePath(
    "outputs/report.pdf",
    "/tmp/nanthai-edge/chat_1/vm-python",
  );

  assert.equal(resolved, "/tmp/nanthai-edge/chat_1/vm-python/outputs/report.pdf");
});

test("resolvePersistentRuntimeWorkspacePath rejects paths outside the workspace", () => {
  assert.throws(
    () =>
      resolvePersistentRuntimeWorkspacePath(
        "../../etc/passwd",
        "/tmp/nanthai-edge/chat_1/vm-python",
      ),
    /outside the persistent VM workspace/i,
  );
});

test("resolvePersistentRuntimeWorkspacePath rejects deleting the workspace root", () => {
  assert.throws(
    () =>
      resolvePersistentRuntimeWorkspacePath(
        "/tmp/nanthai-edge/chat_1/vm-python",
        "/tmp/nanthai-edge/chat_1/vm-python",
      ),
    /workspace root/i,
  );
});

test("persistent VM service functions execute filesystem, import, export, and reset workflows", async () => {
  const restoreEnv = withSandboxEnv();
  const commands: Array<{ cmd: string; args: string[] }> = [];
  const writes: Array<Array<Record<string, unknown>>> = [];
  const stored: Blob[] = [];
  const mutations: Array<Record<string, unknown>> = [];

  const sandbox = {
    sandboxId: "sbx_vm",
    runCommand: async (cmd: string, args: string[]) => {
      commands.push({ cmd, args });
      const shell = args.join(" ");
      if (cmd === "bash" && shell.includes("find")) {
        return {
          exitCode: 0,
          stdout: async () =>
            [
              "d\t/tmp/nanthai-edge/chat_1/vm-python/inputs",
              "f\t/tmp/nanthai-edge/chat_1/vm-python/outputs/report.txt",
            ].join("\n"),
          stderr: async () => "",
        };
      }
      return { exitCode: 0, stdout: async () => "", stderr: async () => "" };
    },
    writeFiles: async (files: Array<Record<string, unknown>>) => {
      writes.push(files);
    },
    readFileToBuffer: async ({ path }: { path: string }) => {
      if (path.endsWith("missing.txt")) return null;
      if (path.endsWith("image.png")) return Buffer.from([137, 80, 78, 71]);
      if (path.endsWith("existing.txt")) return Buffer.from("old");
      if (path.endsWith("export.csv")) return Buffer.from("a,b\n1,2\n");
      return Buffer.from("hello world");
    },
  } as any;

  const createMock = mock.method(Sandbox, "create", async () => sandbox);
  const getMock = mock.method(Sandbox, "get", async () => {
    throw new Error("no existing sandbox expected");
  });

  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: {
      runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
        if (args.storageId) {
          return {
            storageId: args.storageId,
            filename: "Source Notes.txt",
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
        getUrl: async (storageId: string) => `https://files.example/${storageId}`,
      },
    },
  } as any;

  const list = await listPersistentRuntimeFiles(toolCtx, "python", undefined, false);
  const textRead = await readPersistentRuntimeFile(
    toolCtx,
    "python",
    "/tmp/nanthai-edge/chat_1/vm-python/outputs/report.txt",
    5,
  );
  const binaryRead = await readPersistentRuntimeFile(
    toolCtx,
    "python",
    "/tmp/nanthai-edge/chat_1/vm-python/outputs/image.png",
  );
  const missingRead = await readPersistentRuntimeFile(
    toolCtx,
    "python",
    "/tmp/nanthai-edge/chat_1/vm-python/outputs/missing.txt",
  );
  const writeConflict = await writePersistentRuntimeFile(
    toolCtx,
    "python",
    "/tmp/nanthai-edge/chat_1/vm-python/outputs/existing.txt",
    "new",
    false,
  );
  const writeReplace = await writePersistentRuntimeFile(
    toolCtx,
    "node",
    "/tmp/nanthai-edge/chat_1/vm-node/outputs/new.txt",
    "new",
    true,
  );
  const deleted = await deletePersistentRuntimePath(
    toolCtx,
    "python",
    "outputs/report.txt",
  );
  const made = await makePersistentRuntimeDirs(toolCtx, "python", "outputs/nested");
  const imported = await importOwnedStorageFileToPersistentRuntime(
    toolCtx,
    "python",
    "storage_1",
    undefined,
    "inputs/source.txt",
  );
  const exported = await exportPersistentRuntimeFile(
    toolCtx,
    "python",
    "/tmp/nanthai-edge/chat_1/vm-python/outputs/export.csv",
    "export.csv",
  );
  const reset = await resetPersistentRuntime(toolCtx, "node");

  assert.deepEqual(list.files, [
    { name: "inputs", path: "/tmp/nanthai-edge/chat_1/vm-python/inputs", type: "dir" },
    { name: "report.txt", path: "/tmp/nanthai-edge/chat_1/vm-python/outputs/report.txt", type: "file" },
  ]);
  assert.equal(textRead.content, "hello");
  assert.equal(textRead.truncated, true);
  assert.equal(binaryRead.isBinary, true);
  assert.match(String(binaryRead.error), /binary/i);
  assert.equal(missingRead.content, null);
  assert.match(String(missingRead.error), /not found/i);
  assert.match(String(writeConflict.error), /overwrite=false/);
  assert.equal(writeReplace.bytesWritten, 3);
  assert.equal(deleted.path, "/tmp/nanthai-edge/chat_1/vm-python/outputs/report.txt");
  assert.equal(made.created, true);
  assert.equal(imported.path, "/tmp/nanthai-edge/chat_1/vm-python/inputs/source.txt");
  assert.equal(exported.storageId, "stored_1");
  assert.equal(reset.environment, "node");
  assert.equal(toolCtx.sandboxSessionId, "session_1");
  assert.ok(commands.some((entry) => entry.args.join(" ").includes("rm -rf")));
  assert.ok(writes.some((batch) => String(batch[0].path).endsWith("source.txt")));
  assert.equal(stored.length, 1);
  assert.ok(mutations.some((args) => args.storageId === "stored_1"));

  createMock.mock.restore();
  getMock.mock.restore();
  restoreEnv();
});

test("PDF runtime service reads and generates through sandbox payloads and durable storage", async () => {
  const restoreEnv = withSandboxEnv();
  const writes: Array<Array<Record<string, unknown>>> = [];
  const stored: Blob[] = [];

  const sandbox = {
    sandboxId: "sbx_pdf",
    runCommand: async (cmd: string) => {
      if (cmd === "pip") {
        return { exitCode: 0, stdout: async () => "", stderr: async () => "" };
      }
      return { exitCode: 0, stdout: async () => "", stderr: async () => "" };
    },
    writeFiles: async (files: Array<Record<string, unknown>>) => {
      writes.push(files);
    },
    readFileToBuffer: async ({ path }: { path: string }) => {
      if (path.endsWith("pdf_result.json")) {
        return Buffer.from(JSON.stringify({
          filename: "Quarterly Plan.pdf",
          storageId: "document-version",
          pageCount: 2,
          text: "Page one\n\nPage two",
          textTruncated: false,
          fullTextCharCount: 18,
          pages: [{ pageNumber: 1, charCount: 8, textExcerpt: "Page one" }],
          metadata: { Title: "Quarterly Plan" },
        }));
      }
      if (path.endsWith(".pdf")) {
        return Buffer.from("%PDF fixture");
      }
      return null;
    },
  } as any;

  const createMock = mock.method(Sandbox, "create", async () => sandbox);
  const getMock = mock.method(Sandbox, "get", async () => {
    throw new Error("no existing sandbox expected");
  });

  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: {
      runQuery: async () => null,
      runMutation: async () => "session_1",
      storage: {
        store: async (blob: Blob) => {
          stored.push(blob);
          return "pdf_storage_1";
        },
        getUrl: async () => "https://files.example/pdf_storage_1",
      },
    },
  } as any;

  const read = await readPdfBlob(
    toolCtx,
    new Blob(["%PDF input"], { type: "application/pdf" }),
    "Quarterly Plan.pdf",
  );
  const generated = await generatePdfDocument(toolCtx, {
    title: "Quarterly Plan",
    filename: "Quarterly: Plan?.pdf",
    author: "NanthAI",
    sections: [{ heading: "Summary", body: "Revenue improved." }],
  });

  assert.equal(read.pageCount, 2);
  assert.equal(read.metadata.Title, "Quarterly Plan");
  assert.equal(generated.storageId, "pdf_storage_1");
  assert.equal(generated.filename, "Quarterly_ Plan_.pdf");
  assert.equal(generated.mimeType, "application/pdf");
  assert.equal(stored.length, 1);
  assert.ok(
    writes.some((batch) =>
      batch.some((file) =>
        String(file.path).endsWith("Quarterly_Plan.pdf"),
      ),
    ),
  );

  createMock.mock.restore();
  getMock.mock.restore();
  restoreEnv();
});
