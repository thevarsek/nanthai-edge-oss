import assert from "node:assert/strict";
import test from "node:test";

import {
  createRuntimeAnalyticsDepsForTest,
  runDataPythonExec,
} from "../runtime/service_analytics";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

test("runDataPythonExec requires chatId in the tool execution context", async () => {
  await assert.rejects(
    () =>
      runDataPythonExec(
        {
          userId: "user_1",
          ctx: createMockCtx({}),
        } as any,
        { code: "print('hi')" },
      ),
    /require chatId/i,
  );
});

test("runDataPythonExec imports files, persists chart artifacts, exports requested files, and records completion events", async () => {
  const imported: string[] = [];
  const markCalls: string[] = [];
  const exportCalls: string[] = [];
  const stored: Blob[] = [];
  const mutations: Record<string, unknown>[] = [];

  const session = {
    sessionId: "session_1",
    cwd: "/tmp/nanthai-edge/chat_1",
    sandbox: {
      runCode: async () => ({
        text: "done",
        results: [
          { chart: { raw: "chart" }, png: "png-data", text: "chart text", formats: () => ["png"] },
        ],
        logs: { stdout: ["done"], stderr: [] },
      }),
    },
  };

  const deps = createRuntimeAnalyticsDepsForTest({
    ensureSandboxForChat: async () => session as any,
    markSandboxSessionRunning: async (_toolCtx: unknown, currentSession: any) => {
      markCalls.push(currentSession.sessionId);
    },
    importOwnedStorageFileToWorkspace: async (_toolCtx: unknown, storageId: string) => {
      imported.push(storageId);
      return {
        path: `/tmp/imports/${storageId}`,
        filename: `${storageId}.txt`,
        mimeType: "text/plain",
        sizeBytes: 1,
        storageId: "storage_input" as any,
        source: "upload" as const,
      };
    },
    normalizeE2BChart: () => ({
      toolName: "data_python_exec",
      chartType: "line",
      title: "Trend",
      elements: [{ x: "Jan", y: 1 }],
    }) as any,
    buildChartPreviewArtifact: (_png: string, index: number) => ({
      filename: `chart-${index}.png`,
      mimeType: "image/png",
      blob: new Blob(["png"], { type: "image/png" }),
    }) as any,
    buildChartDataArtifact: () => ({
      filename: "trend.csv",
      mimeType: "text/csv",
      blob: new Blob(["x,y\nJan,1"], { type: "text/csv" }),
    }) as any,
    exportWorkspaceFile: async (_toolCtx: unknown, path: string) => {
      exportCalls.push(path);
      return {
        path,
        filename: "report.txt",
        mimeType: "text/plain",
        sizeBytes: 7,
        storageId: "storage_export" as any,
        downloadUrl: null,
        markdownLink: "[report.txt](https://example.com/report.txt)",
        message: "Exported report.txt",
      };
    },
  });

  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: createMockCtx({
      storage: {
        store: async (blob: Blob) => {
          stored.push(blob);
          return `storage_${stored.length}`;
        },
      },
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    }),
  } as any;

  const result = await runDataPythonExec(toolCtx, {
    code: "print('hi')",
    inputFiles: [{ storageId: "input_1" }],
    exportPaths: ["/tmp/nanthai-edge/chat_1/outputs/report.txt"],
  }, deps);

  assert.deepEqual(imported, ["input_1"]);
  assert.deepEqual(markCalls, ["session_1"]);
  assert.deepEqual(exportCalls, ["/tmp/nanthai-edge/chat_1/outputs/report.txt"]);
  assert.equal(stored.length, 2);
  assert.equal(result.text, "done");
  assert.equal(result.chartsCreated.length, 1);
  assert.equal(result.exportedFiles.length, 3);
  assert.equal(mutations.some((entry) => entry.eventType === "data_python_exec_completed"), true);
  assert.equal(
    mutations.filter((entry) => entry.filename === "chart-1.png" || entry.filename === "trend.csv").length,
    2,
  );
});

test("runDataPythonExec warns on unnormalized charts and surfaces sandbox execution errors", async () => {
  const markCalls: string[] = [];
  const session = {
    sessionId: "session_2",
    cwd: "/tmp/nanthai-edge/chat_1",
    sandbox: {
      runCode: async () => ({
        error: { name: "RuntimeError", value: "python exploded" },
        results: [],
        logs: { stdout: [], stderr: [] },
      }),
    },
  };

  const deps = createRuntimeAnalyticsDepsForTest({
    ensureSandboxForChat: async () => session as any,
    markSandboxSessionRunning: async (_toolCtx: unknown, currentSession: any) => {
      markCalls.push(currentSession.sessionId);
    },
  });

  await assert.rejects(
    () =>
      runDataPythonExec(
        {
          userId: "user_1",
          chatId: "chat_1",
          ctx: createMockCtx({
            storage: { store: async () => "storage_1" },
            runMutation: async () => undefined,
          }),
        } as any,
        { code: "raise SystemExit(1)" },
        deps,
      ),
    /RuntimeError: python exploded/,
  );

  assert.deepEqual(markCalls, ["session_2"]);
});

test("runDataPythonExec falls back to preview-only artifacts when chart normalization fails", async () => {
  const stored: string[] = [];
  const mutations: Record<string, unknown>[] = [];
  const session = {
    sessionId: "session_3",
    cwd: "/tmp/nanthai-edge/chat_1",
    sandbox: {
      runCode: async () => ({
        text: "",
        results: [{ chart: { raw: "bad-chart" }, png: "png-data" }],
        logs: { stdout: ["stdout"], stderr: [] },
      }),
    },
  };

  const deps = createRuntimeAnalyticsDepsForTest({
    ensureSandboxForChat: async () => session as any,
    markSandboxSessionRunning: async () => undefined,
    normalizeE2BChart: () => null,
    buildChartPreviewArtifact: () => ({
      filename: "fallback.png",
      mimeType: "image/png",
      blob: new Blob(["png"], { type: "image/png" }),
    }) as any,
  });

  const result = await runDataPythonExec(
    {
      userId: "user_1",
      chatId: "chat_1",
      ctx: createMockCtx({
        storage: {
          store: async () => {
            stored.push("stored");
            return `storage_${stored.length}`;
          },
        },
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          mutations.push(args);
        },
      }),
    } as any,
    { code: "plot()", exportPaths: [] },
    deps,
  );

  assert.equal(result.text, "");
  assert.equal(result.exportedFiles.length, 1);
  assert.equal(result.warnings[0]?.includes("could not be normalized"), true);
  assert.equal(stored.length, 1);
  assert.equal(mutations.some((entry) => entry.filename === "fallback.png"), true);
});
