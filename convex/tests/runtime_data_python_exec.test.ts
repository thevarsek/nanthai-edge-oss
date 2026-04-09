import assert from "node:assert/strict";
import test from "node:test";

import {
  createRuntimeAnalyticsDepsForTest,
  runDataPythonExec,
} from "../runtime/service_analytics";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

// ---------------------------------------------------------------------------
// runDataPythonExec — Pyodide-based implementation contract tests
//
// These tests verify the function's contract without hitting the real Pyodide
// runtime. All Pyodide execution is mocked via createRuntimeAnalyticsDepsForTest.
// ---------------------------------------------------------------------------

// A minimal successful Pyodide exec result
function makePyodideSuccessResult(overrides: Record<string, unknown> = {}) {
  return {
    stdout: ["hello"],
    stderr: [],
    charts: [],
    error: null,
    canRetryWithSandbox: false,
    returnValue: null,
    errorType: null,
    outputFiles: [],
    memoryRssMiB: {
      baseline: 100,
      afterLoad: 300,
      afterPackages: 400,
      afterExecution: 420,
    },
    ...overrides,
  };
}

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

test("runDataPythonExec returns stdout text on success", async () => {
  const deps = createRuntimeAnalyticsDepsForTest({
    runPyodideCode: async () => makePyodideSuccessResult({ stdout: ["42"] }),
    resolveOwnedStorageFile: async () => ({
      record: {
        storageId: "storage_1" as any,
        filename: "file.csv",
        mimeType: "text/csv",
        sizeBytes: 10,
        userId: "user_1" as any,
      } as any,
      blob: new Blob(["a,b\n1,2"], { type: "text/csv" }),
    }),
  });

  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: createMockCtx({}),
  } as any;

  const result = await runDataPythonExec(toolCtx, { code: "print(42)" }, deps);
  assert.ok(result.text.includes("42"), "should include stdout in text");
  assert.deepEqual(result.chartsCreated, []);
  assert.deepEqual(result.exportedFiles, []);
});

test("runDataPythonExec returns error text when Pyodide reports error", async () => {
  const deps = createRuntimeAnalyticsDepsForTest({
    runPyodideCode: async () =>
      makePyodideSuccessResult({
        stdout: [],
        stderr: ["Traceback..."],
        error: "NameError: name 'x' is not defined",
        canRetryWithSandbox: true,
      }),
  });

  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: createMockCtx({}),
  } as any;

  const result = await runDataPythonExec(toolCtx, { code: "print(x)" }, deps);
  assert.ok(result.text.includes("NameError"), "error message should appear in text");
  assert.ok(result.resultsSummary.some((s) => /NameError/.test(s)));
});

test("runDataPythonExec warns when memory exceeds 600 MiB", async () => {
  const deps = createRuntimeAnalyticsDepsForTest({
    runPyodideCode: async () =>
      makePyodideSuccessResult({
        stdout: ["ok"],
        memoryRssMiB: {
          baseline: 100,
          afterLoad: 300,
          afterPackages: 400,
          afterExecution: 650,
        },
      }),
  });

  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: createMockCtx({}),
  } as any;

  const result = await runDataPythonExec(toolCtx, { code: "pass" }, deps);
  assert.ok(
    result.warnings.some((w) => /memory|high/i.test(w)),
    "should warn about high memory usage",
  );
});

test("runDataPythonExec processes PNG charts and stores them as exported files", async () => {
  const pngBytes = new Uint8Array([137, 80, 78, 71]); // minimal PNG header
  const deps = createRuntimeAnalyticsDepsForTest({
    runPyodideCode: async () =>
      makePyodideSuccessResult({
        charts: [{ pngBytes, index: 0 }],
      }),
    storeArtifactBytes: async (_toolCtx: unknown, _bytes: Uint8Array, filename: string, mimeType: string) => ({
      storageId: "storage_chart_0" as any,
      filename,
      mimeType,
      sizeBytes: 4,
      downloadUrl: `https://example.com/${filename}`,
      markdownLink: `[${filename}](https://example.com/${filename})`,
    }),
  });

  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: createMockCtx({}),
  } as any;

  const result = await runDataPythonExec(
    toolCtx,
    { code: "import matplotlib.pyplot as plt; plt.plot([1,2]); plt.show()" },
    deps,
  );

  // Charts are no longer pushed to chartsCreated (images render inline via
  // download URL in the model's markdown), but are still stored as exported files.
  assert.equal(result.chartsCreated.length, 0);
  assert.equal(result.exportedFiles.length, 1);
  assert.equal(result.exportedFiles[0].storageId, "storage_chart_0");
});

test("createRuntimeAnalyticsDepsForTest merges overrides correctly", () => {
  let calledRunPyodide = false;
  const deps = createRuntimeAnalyticsDepsForTest({
    runPyodideCode: async () => {
      calledRunPyodide = true;
      return makePyodideSuccessResult();
    },
  });

  // Override is applied
  assert.equal(typeof deps.runPyodideCode, "function");
  // Other deps are still present
  assert.equal(typeof deps.storeArtifactBytes, "function");
  assert.equal(typeof deps.resolveOwnedStorageFile, "function");
  assert.equal(typeof deps.buildChartPreviewArtifact, "function");

  deps.runPyodideCode("", undefined, true, undefined).then(() => {
    assert.ok(calledRunPyodide, "override runPyodideCode should have been called");
  });
});
