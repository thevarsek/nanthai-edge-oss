import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { Sandbox } from "@vercel/sandbox";

import { runVercelSandboxCode } from "../runtime/vercel_sandbox_client";

function withSandboxEnv() {
  const prev = {
    token: process.env.VERCEL_SANDBOX_TOKEN,
    projectId: process.env.VERCEL_SANDBOX_PROJECT_ID,
    teamId: process.env.VERCEL_SANDBOX_TEAM_ID,
  };
  process.env.VERCEL_SANDBOX_TOKEN = "token";
  process.env.VERCEL_SANDBOX_PROJECT_ID = "project";
  process.env.VERCEL_SANDBOX_TEAM_ID = "team";
  return () => {
    process.env.VERCEL_SANDBOX_TOKEN = prev.token;
    process.env.VERCEL_SANDBOX_PROJECT_ID = prev.projectId;
    process.env.VERCEL_SANDBOX_TEAM_ID = prev.teamId;
  };
}

test("runVercelSandboxCode resumes sandboxes, captures charts, and collects export files", async () => {
  const restoreEnv = withSandboxEnv();
  const writes: Array<Array<Record<string, unknown>>> = [];
  const commands: Array<{ cmd: string; args: string[]; opts?: Record<string, unknown> }> = [];
  let snapshotCount = 0;

  const sandbox = {
    sandboxId: "sbx_existing",
    extendTimeout: async () => {
      throw new Error("limit reached");
    },
    runCommand: async (cmd: string, args: string[], opts?: Record<string, unknown>) => {
      commands.push({ cmd, args, opts });
      if (cmd === "python3" && args[0] === "-c" && args[2] === "/tmp/outputs") {
        snapshotCount += 1;
        const entries = snapshotCount === 1
          ? [{ path: "/tmp/outputs/existing.csv", signature: "old" }]
          : [
              { path: "/tmp/outputs/existing.csv", signature: "old" },
              { path: "/tmp/outputs/new.csv", signature: "new" },
            ];
        return { exitCode: 0, stdout: async () => JSON.stringify(entries), stderr: async () => "" };
      }
      if (cmd === "python3" && args[0] === "-c") {
        return { exitCode: 0, stdout: async () => "", stderr: async () => "" };
      }
      if (cmd === "pip") {
        throw new Error("pip failed");
      }
      if (cmd === "python3" && args[0] === "/tmp/_nanthai_run.py") {
        return { exitCode: 0, stdout: async () => "hello", stderr: async () => "" };
      }
      if (cmd === "bash") {
        return {
          exitCode: 0,
          stdout: async () => "/tmp/_nanthai_charts/chart_0.png\n",
          stderr: async () => "",
        };
      }
      return { exitCode: 0, stdout: async () => "", stderr: async () => "" };
    },
    writeFiles: async (files: Array<Record<string, unknown>>) => {
      writes.push(files);
    },
    readFileToBuffer: async ({ path }: { path: string }) => {
      if (path.endsWith("chart_0.png")) return Buffer.from([137, 80, 78, 71]);
      if (path.endsWith("report.json")) return Buffer.from('{"ok":true}');
      if (path.endsWith("new.csv")) return Buffer.from("a,b\n");
      return null;
    },
  } as any;

  const getMock = mock.method(Sandbox, "get", async () => sandbox);
  const createMock = mock.method(Sandbox, "create", async () => {
    throw new Error("create should not run");
  });

  const result = await runVercelSandboxCode(
    "print('hello')",
    "sbx_existing",
    [{ path: "/tmp/inputs/data.csv", bytes: new Uint8Array([1, 2, 3]) }],
    true,
    ["pandas"],
    5000,
    ["/tmp/outputs/report.json"],
  );

  assert.equal(result.sandboxId, "sbx_existing");
  assert.equal(result.stdout, "hello");
  assert.equal(result.error, null);
  assert.equal(result.charts.length, 1);
  assert.deepEqual(
    result.outputFiles.map((file) => [file.path, file.mimeType]),
    [
      ["/tmp/outputs/report.json", "application/json"],
      ["/tmp/outputs/new.csv", "text/csv"],
    ],
  );
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], [{ path: "/tmp/inputs/data.csv", content: new Uint8Array([1, 2, 3]) }]);
  assert.equal((writes[1][0] as any).path, "/tmp/_nanthai_run.py");
  assert.match(String((writes[1][0] as any).content), /matplotlib/);
  assert.equal(getMock.mock.calls.length, 1);
  assert.equal(createMock.mock.calls.length, 0);

  getMock.mock.restore();
  createMock.mock.restore();
  restoreEnv();
});

test("runVercelSandboxCode falls back to create and returns timeout errors", async () => {
  const restoreEnv = withSandboxEnv();

  const sandbox = {
    sandboxId: "sbx_new",
    runCommand: async (cmd: string, args: string[]) => {
      if (cmd === "python3" && args[0] === "-c") {
        return { exitCode: 0, stdout: async () => "[]", stderr: async () => "" };
      }
      if (cmd === "python3" && args[0] === "/tmp/_nanthai_run.py") {
        throw new Error("timed out");
      }
      return { exitCode: 0, stdout: async () => "", stderr: async () => "" };
    },
    writeFiles: async () => {},
    readFileToBuffer: async () => null,
  } as any;

  const getMock = mock.method(Sandbox, "get", async () => {
    throw new Error("sandbox gone");
  });
  const createMock = mock.method(Sandbox, "create", async () => sandbox);

  const result = await runVercelSandboxCode("print('timeout')", "sbx_old");

  assert.equal(result.sandboxId, "sbx_new");
  assert.equal(result.exitCode, 1);
  assert.match(String(result.error), /timed out/i);
  assert.equal(result.charts.length, 0);
  assert.equal(result.outputFiles.length, 0);
  assert.equal(getMock.mock.calls.length, 1);
  assert.equal(createMock.mock.calls.length, 1);

  getMock.mock.restore();
  createMock.mock.restore();
  restoreEnv();
});
