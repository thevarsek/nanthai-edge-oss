import assert from "node:assert/strict";
import test from "node:test";

import {
  createRuntimeSandboxDepsForTest,
  runDataPythonSandbox,
} from "../runtime/service_analytics_sandbox";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

// ---------------------------------------------------------------------------
// runDataPythonSandbox — Vercel Sandbox contract tests
//
// These tests verify the function's contract without hitting the real Vercel
// Sandbox runtime. All sandbox execution is mocked via
// createRuntimeSandboxDepsForTest.
// ---------------------------------------------------------------------------

// A minimal successful Vercel Sandbox exec result
function makeSandboxSuccessResult(overrides: Record<string, unknown> = {}) {
  return {
    sandboxId: "sbx_test_123",
    stdout: "hello",
    stderr: "",
    exitCode: 0,
    error: null,
    charts: [],
    outputFiles: [],
    sandbox: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. requires chatId
// ---------------------------------------------------------------------------

test("runDataPythonSandbox requires chatId in the tool execution context", async () => {
  await assert.rejects(
    () =>
      runDataPythonSandbox(
        {
          userId: "user_1",
          ctx: createMockCtx({}),
        } as any,
        { code: "print('hi')" },
      ),
    /require chatId/i,
  );
});

// ---------------------------------------------------------------------------
// 2. returns stdout on success
// ---------------------------------------------------------------------------

test("runDataPythonSandbox returns stdout text on success", async () => {
  const deps = createRuntimeSandboxDepsForTest({
    runVercelSandboxCode: async () => makeSandboxSuccessResult({ stdout: "42" }),
  });

  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: createMockCtx({
      runQuery: async () => null,
      runMutation: async () => "session_new",
    }),
  } as any;

  const result = await runDataPythonSandbox(toolCtx, { code: "print(42)" }, deps);
  assert.ok(result.text.includes("42"), "should include stdout in text");
  assert.deepEqual(result.chartsCreated, []);
  assert.deepEqual(result.exportedFiles, []);
});

// ---------------------------------------------------------------------------
// 3. returns error text on failure
// ---------------------------------------------------------------------------

test("runDataPythonSandbox returns error text when sandbox reports error", async () => {
  const deps = createRuntimeSandboxDepsForTest({
    runVercelSandboxCode: async () =>
      makeSandboxSuccessResult({
        stdout: "",
        stderr: "Traceback (most recent call last):\n  ...",
        error: "NameError: name 'x' is not defined",
        exitCode: 1,
      }),
  });

  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: createMockCtx({
      runQuery: async () => null,
      runMutation: async () => "session_new",
    }),
  } as any;

  const result = await runDataPythonSandbox(toolCtx, { code: "print(x)" }, deps);
  assert.ok(result.text.includes("NameError"), "error message should appear in text");
  assert.ok(result.resultsSummary.some((s) => /NameError/.test(s)));
});

// ---------------------------------------------------------------------------
// 4. resumes existing session
// ---------------------------------------------------------------------------

test("runDataPythonSandbox passes existingSandboxId when session exists", async () => {
  let capturedExistingSandboxId: string | undefined;
  const deps = createRuntimeSandboxDepsForTest({
    runVercelSandboxCode: async (
      _code: string,
      existingSandboxId?: string,
    ) => {
      capturedExistingSandboxId = existingSandboxId;
      return makeSandboxSuccessResult({ sandboxId: "sbx_existing_999" });
    },
  });

  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: createMockCtx({
      runQuery: async () => ({
        _id: "session_existing",
        provider: "vercel",
        status: "running",
        providerSandboxId: "sbx_existing_999",
      }),
      runMutation: async () => undefined,
    }),
  } as any;

  await runDataPythonSandbox(toolCtx, { code: "print('resume')" }, deps);
  assert.equal(capturedExistingSandboxId, "sbx_existing_999", "should pass existing sandbox ID");
  assert.equal(toolCtx.sandboxSessionId, "session_existing", "should set sandboxSessionId from existing session");
});

// ---------------------------------------------------------------------------
// 5. creates new session when no existing
// ---------------------------------------------------------------------------

test("runDataPythonSandbox creates new session when no existing session found", async () => {
  let capturedExistingSandboxId: string | undefined;
  const deps = createRuntimeSandboxDepsForTest({
    runVercelSandboxCode: async (
      _code: string,
      existingSandboxId?: string,
    ) => {
      capturedExistingSandboxId = existingSandboxId;
      return makeSandboxSuccessResult({ sandboxId: "sbx_brand_new" });
    },
  });

  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: createMockCtx({
      runQuery: async () => null,
      runMutation: async () => "session_brand_new",
    }),
  } as any;

  await runDataPythonSandbox(toolCtx, { code: "print('new')" }, deps);
  assert.equal(capturedExistingSandboxId, undefined, "should not pass existingSandboxId for new session");
  assert.equal(toolCtx.sandboxSessionId, "session_brand_new", "should set sandboxSessionId from newly created session");
});

// ---------------------------------------------------------------------------
// 6. processes charts as exported files
// ---------------------------------------------------------------------------

test("runDataPythonSandbox processes PNG charts and stores them as exported files", async () => {
  const pngBytes = new Uint8Array([137, 80, 78, 71]); // minimal PNG header
  const deps = createRuntimeSandboxDepsForTest({
    runVercelSandboxCode: async () =>
      makeSandboxSuccessResult({
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
    ctx: createMockCtx({
      runQuery: async () => null,
      runMutation: async () => "session_charts",
    }),
  } as any;

  const result = await runDataPythonSandbox(
    toolCtx,
    { code: "import matplotlib.pyplot as plt; plt.plot([1,2]); plt.show()" },
    deps,
  );

  // Charts are stored as exported files, not in chartsCreated
  assert.equal(result.chartsCreated.length, 0);
  assert.equal(result.exportedFiles.length, 1);
  assert.equal(result.exportedFiles[0].storageId, "storage_chart_0");
});

// ---------------------------------------------------------------------------
// 7. processes output files
// ---------------------------------------------------------------------------

test("runDataPythonSandbox processes output files and stores them as exported files", async () => {
  const csvBytes = new Uint8Array([0x61, 0x2c, 0x62, 0x0a]); // "a,b\n"
  const deps = createRuntimeSandboxDepsForTest({
    runVercelSandboxCode: async () =>
      makeSandboxSuccessResult({
        outputFiles: [{ path: "/tmp/output/results.csv", bytes: csvBytes, mimeType: "text/csv" }],
      }),
    storeArtifactBytes: async (_toolCtx: unknown, _bytes: Uint8Array, filename: string, mimeType: string) => ({
      storageId: "storage_output_0" as any,
      filename,
      mimeType,
      sizeBytes: csvBytes.byteLength,
      downloadUrl: `https://example.com/${filename}`,
      markdownLink: `[${filename}](https://example.com/${filename})`,
    }),
  });

  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: createMockCtx({
      runQuery: async () => null,
      runMutation: async () => "session_output",
    }),
  } as any;

  const result = await runDataPythonSandbox(
    toolCtx,
    { code: "import csv; # write output", exportPaths: ["/tmp/output/results.csv"] },
    deps,
  );

  assert.equal(result.exportedFiles.length, 1);
  assert.equal(result.exportedFiles[0].storageId, "storage_output_0");
  assert.equal(result.exportedFiles[0].mimeType, "text/csv");
  assert.equal(result.exportedFiles[0].path, "/tmp/output/results.csv");
});

// ---------------------------------------------------------------------------
// 8. auto-detects packages from code
// ---------------------------------------------------------------------------

test("runDataPythonSandbox auto-detects packages from import statements", async () => {
  let capturedPackages: string[] | undefined;
  const deps = createRuntimeSandboxDepsForTest({
    runVercelSandboxCode: async (
      _code: string,
      _existingSandboxId?: string,
      _inputFiles?: unknown,
      _captureCharts?: boolean,
      packages?: string[],
    ) => {
      capturedPackages = packages;
      return makeSandboxSuccessResult();
    },
  });

  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: createMockCtx({
      runQuery: async () => null,
      runMutation: async () => "session_pkg",
    }),
  } as any;

  const code = [
    "import pandas as pd",
    "import numpy as np",
    "from scipy.stats import norm",
    "from sklearn.linear_model import LinearRegression",
  ].join("\n");

  await runDataPythonSandbox(toolCtx, { code, captureCharts: false }, deps);

  assert.ok(capturedPackages, "packages should be passed to runVercelSandboxCode");
  assert.ok(capturedPackages!.includes("pandas"), "should detect pandas");
  assert.ok(capturedPackages!.includes("numpy"), "should detect numpy");
  assert.ok(capturedPackages!.includes("scipy"), "should detect scipy");
  assert.ok(capturedPackages!.includes("scikit-learn"), "should detect sklearn as scikit-learn");
});

// ---------------------------------------------------------------------------
// 9. auto-adds matplotlib when captureCharts enabled
// ---------------------------------------------------------------------------

test("runDataPythonSandbox auto-adds matplotlib when captureCharts is enabled", async () => {
  let capturedPackages: string[] | undefined;
  const deps = createRuntimeSandboxDepsForTest({
    runVercelSandboxCode: async (
      _code: string,
      _existingSandboxId?: string,
      _inputFiles?: unknown,
      _captureCharts?: boolean,
      packages?: string[],
    ) => {
      capturedPackages = packages;
      return makeSandboxSuccessResult();
    },
  });

  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: createMockCtx({
      runQuery: async () => null,
      runMutation: async () => "session_mpl",
    }),
  } as any;

  // Code has no matplotlib import, but captureCharts defaults to true
  await runDataPythonSandbox(toolCtx, { code: "print('no imports')" }, deps);

  assert.ok(capturedPackages, "packages should be passed to runVercelSandboxCode");
  assert.ok(
    capturedPackages!.some((p) => p.toLowerCase() === "matplotlib"),
    "should auto-add matplotlib when captureCharts is enabled",
  );
});

// ---------------------------------------------------------------------------
// 10. session tracking failure is non-fatal
// ---------------------------------------------------------------------------

test("runDataPythonSandbox treats session tracking failure as non-fatal warning", async () => {
  const deps = createRuntimeSandboxDepsForTest({
    runVercelSandboxCode: async () => makeSandboxSuccessResult({ stdout: "ok" }),
  });

  const toolCtx = {
    userId: "user_1",
    chatId: "chat_1",
    ctx: createMockCtx({
      runQuery: async () => null,
      runMutation: async () => {
        throw new Error("DB write failed");
      },
    }),
  } as any;

  const result = await runDataPythonSandbox(toolCtx, { code: "print('ok')" }, deps);

  // Result should still be returned successfully
  assert.ok(result.text.includes("ok"), "result should still contain stdout");
  assert.ok(
    result.warnings.some((w) => /session tracking failed/i.test(w)),
    "should include a session tracking warning",
  );
});
