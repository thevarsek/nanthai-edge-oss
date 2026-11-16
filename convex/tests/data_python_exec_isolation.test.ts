import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test, { mock } from "node:test";

import { Sandbox } from "@vercel/sandbox";

import { execute } from "../analytics_workflows/actions";
import { deserializeAnalyticsEnvelope } from "../runtime/analytics_execution_envelope";
import { PYTHON_SANDBOX_UNAVAILABLE_ERROR } from "../runtime/vercel_sandbox_config";
import { dataPythonExec } from "../tools/data_python_exec";

// data_python_exec must execute model-supplied code only in the isolated
// Vercel Sandbox, and must fail closed when that sandbox is not configured.

const SANDBOX_ENV_KEYS = [
  "VERCEL_SANDBOX_TOKEN",
  "VERCEL_SANDBOX_PROJECT_ID",
  "VERCEL_SANDBOX_TEAM_ID",
] as const;

function withSandboxEnv(configured: boolean): () => void {
  const previous = SANDBOX_ENV_KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of SANDBOX_ENV_KEYS) {
    if (configured) process.env[key] = `test-${key}`;
    else delete process.env[key];
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

const generationContext = {
  userId: "user_1",
  chatId: "chat_1",
  messageId: "message_1",
  userMessageId: "user_message_1",
  jobId: "job_1",
  toolCallId: "call_1",
};

const preparedRun = {
  _id: "run_1",
  ...generationContext,
  status: "running",
  toolName: "data_python_exec",
  code: "print(6 * 7)",
  inputFiles: [],
  exportPaths: [],
  captureCharts: false,
  packages: [],
  artifactKey: "job_1:call_1",
  executionAttemptId: "attempt_1",
  executionFence: 1,
};

type Handler = (ctx: unknown, args: Record<string, unknown>) => Promise<null>;
const executeHandler = (execute as unknown as { _handler: Handler })._handler;

function analyticsActionCtx(storedBlobs: Blob[], storedResults: Array<Record<string, unknown>>) {
  return {
    runQuery: async (_reference: unknown, args: Record<string, unknown>) =>
      "analyticsRunId" in args ? preparedRun : null,
    runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
      if ("phase" in args) return null;
      if ("environment" in args) return "session_1";
      if ("error" in args) {
        storedResults.push(args);
        return null;
      }
      if ("storageId" in args) return true;
      throw new Error(`Unexpected mutation: ${JSON.stringify(args)}`);
    },
    runAction: async () => null,
    storage: {
      store: async (blob: Blob) => {
        storedBlobs.push(blob);
        return "envelope_storage_1";
      },
      delete: async () => undefined,
    },
  };
}

test("data_python_exec tool fails closed before queueing work when the sandbox is not configured", async () => {
  const restoreEnv = withSandboxEnv(false);
  let mutationCalls = 0;
  try {
    const result = await dataPythonExec.execute(
      {
        ...generationContext,
        ctx: { runMutation: async () => { mutationCalls += 1; return "run_1"; } },
      } as never,
      { code: "print(1)" },
    );
    assert.equal(result.success, false);
    assert.equal(result.error, PYTHON_SANDBOX_UNAVAILABLE_ERROR);
    assert.equal(mutationCalls, 0);
  } finally {
    restoreEnv();
  }
});

test("data_python_exec tool queues a deferred analytics run when the sandbox is configured", async () => {
  const restoreEnv = withSandboxEnv(true);
  const prepared: Array<Record<string, unknown>> = [];
  try {
    const result = await dataPythonExec.execute(
      {
        ...generationContext,
        ctx: {
          runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
            prepared.push(args);
            return "run_1";
          },
        },
      } as never,
      { code: "print(1)", timeoutMs: 60_000 },
    );
    assert.equal(result.success, true);
    assert.deepEqual(result.deferred, { kind: "analytics_workflow", data: { analyticsRunId: "run_1" } });
    assert.equal(prepared.length, 1);
    assert.equal(prepared[0].toolName, "data_python_exec");
    assert.equal(prepared[0].timeoutMs, 60_000);
  } finally {
    restoreEnv();
  }
});

test("data_python_exec analytics run executes in the Vercel Sandbox", async () => {
  const restoreEnv = withSandboxEnv(true);
  const written: Array<{ path: string; content: unknown }> = [];
  const commands: string[] = [];
  const sandbox = {
    sandboxId: "sbx_1",
    extendTimeout: async () => undefined,
    stop: async () => undefined,
    writeFiles: async (files: Array<{ path: string; content: unknown }>) => {
      written.push(...files);
    },
    readFileToBuffer: async () => null,
    runCommand: async (cmd: string, args: string[]) => {
      commands.push([cmd, ...args].join(" "));
      const stdout = cmd === "python3" && args[0] === "-c"
        ? "[]"
        : cmd === "python3" ? "42" : "";
      return { exitCode: 0, stdout: async () => stdout, stderr: async () => "" };
    },
  };
  const createMock = mock.method(Sandbox, "create", async () => sandbox as never);
  const storedBlobs: Blob[] = [];
  const storedResults: Array<Record<string, unknown>> = [];
  try {
    await executeHandler(analyticsActionCtx(storedBlobs, storedResults), {
      analyticsRunId: "run_1",
      claimantId: "analytics-workflow:run_1",
    });
    assert.equal(createMock.mock.callCount(), 1);
    const createArgs = createMock.mock.calls[0].arguments[0] as { runtime?: string };
    assert.equal(createArgs.runtime, "python3.13");
    const codeFile = written.find((file) => file.path === "/tmp/_nanthai_run.py");
    assert.ok(String(codeFile?.content).includes("print(6 * 7)"));
    assert.ok(commands.includes("python3 /tmp/_nanthai_run.py"));
    assert.deepEqual(storedResults, []);
    assert.equal(storedBlobs.length, 1);
    const envelope = deserializeAnalyticsEnvelope(await storedBlobs[0].text());
    assert.equal(envelope.error, null);
    assert.equal(envelope.stdout, "42");
  } finally {
    createMock.mock.restore();
    restoreEnv();
  }
});

test("data_python_exec analytics run fails closed when the sandbox is not configured", async () => {
  const restoreEnv = withSandboxEnv(false);
  const createMock = mock.method(Sandbox, "create", async () => {
    throw new Error("sandbox must not be created without credentials");
  });
  const storedBlobs: Blob[] = [];
  const storedResults: Array<Record<string, unknown>> = [];
  try {
    await executeHandler(analyticsActionCtx(storedBlobs, storedResults), {
      analyticsRunId: "run_1",
      claimantId: "analytics-workflow:run_1",
    });
    assert.equal(createMock.mock.callCount(), 0);
    assert.equal(storedBlobs.length, 0);
    assert.equal(storedResults.length, 1);
    assert.match(String(storedResults[0].error), /Vercel Sandbox not configured/);
  } finally {
    createMock.mock.restore();
    restoreEnv();
  }
});

test("no backend source executes Python in the Convex process", () => {
  const repoRoot = path.resolve(__dirname, "../..");
  const convexRoot = path.join(repoRoot, "convex");
  const offenders: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const fullPath = path.join(directory, entry);
      if (statSync(fullPath).isDirectory()) {
        if (entry !== "_generated" && entry !== "tests" && entry !== "node_modules") visit(fullPath);
        continue;
      }
      if (!/\.(ts|js|mjs)$/.test(entry)) continue;
      if (/pyodide|runInThisContext/i.test(readFileSync(fullPath, "utf8"))) {
        offenders.push(path.relative(repoRoot, fullPath));
      }
    }
  };
  visit(convexRoot);
  assert.deepEqual(offenders, []);

  const manifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal("pyodide" in { ...manifest.dependencies, ...manifest.devDependencies }, false);
});
