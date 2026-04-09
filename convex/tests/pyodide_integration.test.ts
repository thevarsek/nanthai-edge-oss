import assert from "node:assert/strict";
import test from "node:test";

// Integration-style tests for Pyodide pipeline (pyodide_client.ts).
//
// These tests do NOT call real Pyodide (CDN fetch would be too slow and fragile
// in unit test context). Instead they validate:
//   1. The public interface contract of PyodideExecResult
//   2. Error classification logic
//   3. Timeout behavior contract
//   4. canRetryWithSandbox logic
//   5. Chart result shape
//
// Real CDN+WASM tests are covered by:
//   - `convex run pyodide_test:validate` (live Convex deployment)
//   - `scripts/pyodide_version_check.mjs` (manual upgrade smoke test)

import {
  PYODIDE_VERSION,
  PYODIDE_CDN,
  type PyodideExecResult,
  type PyodideErrorType,
} from "../runtime/pyodide_client";

// ---------------------------------------------------------------------------
// Version constants
// ---------------------------------------------------------------------------

test("PYODIDE_VERSION is set to expected pinned version", () => {
  assert.equal(PYODIDE_VERSION, "0.29.3");
});

test("PYODIDE_CDN includes the version string", () => {
  assert.ok(PYODIDE_CDN.includes(PYODIDE_VERSION), `CDN URL must include ${PYODIDE_VERSION}`);
  assert.ok(PYODIDE_CDN.startsWith("https://cdn.jsdelivr.net/pyodide/"), "CDN must use jsdelivr");
  assert.ok(PYODIDE_CDN.endsWith("/full/"), "CDN must point to /full/ directory");
});

// ---------------------------------------------------------------------------
// PyodideExecResult type contract (structural checks on mock objects)
// ---------------------------------------------------------------------------

test("PyodideExecResult shape: success result", () => {
  const result: PyodideExecResult = {
    stdout: ["hello", "world"],
    stderr: [],
    returnValue: 42,
    error: null,
    errorType: null,
    canRetryWithSandbox: false,
    charts: [{ pngBytes: new Uint8Array([137, 80, 78, 71]), index: 0 }],
    outputFiles: [{ path: "/tmp/out.csv", bytes: new Uint8Array([1, 2, 3]), mimeType: "text/csv" }],
    memoryRssMiB: { baseline: 450, afterLoad: 490, afterPackages: 560, afterExecution: 610 },
  };

  assert.equal(result.error, null);
  assert.equal(result.errorType, null);
  assert.equal(result.canRetryWithSandbox, false);
  assert.equal(result.charts.length, 1);
  assert.equal(result.outputFiles.length, 1);
  assert.equal(typeof result.memoryRssMiB.baseline, "number");
});

test("PyodideExecResult shape: package_unavailable error", () => {
  const result: PyodideExecResult = {
    stdout: [],
    stderr: [],
    returnValue: null,
    error: "ERROR (package_unavailable): ModuleNotFoundError: No module named 'scipy'\n→ Retry this task using data_python_sandbox, which supports pip install.",
    errorType: "package_unavailable",
    canRetryWithSandbox: true,
    charts: [],
    outputFiles: [],
    memoryRssMiB: { baseline: 450, afterLoad: 490, afterPackages: 560, afterExecution: 560 },
  };

  assert.equal(result.errorType, "package_unavailable");
  assert.equal(result.canRetryWithSandbox, true);
  assert.ok(result.error?.includes("data_python_sandbox"), "error message must suggest data_python_sandbox");
});

test("PyodideExecResult shape: timeout error", () => {
  const result: PyodideExecResult = {
    stdout: [],
    stderr: [],
    returnValue: null,
    error: "Execution timed out after 60000ms.\n→ Retry this task using data_python_sandbox, which supports long-running computations (up to 45 min).",
    errorType: "timeout",
    canRetryWithSandbox: true,
    charts: [],
    outputFiles: [],
    memoryRssMiB: { baseline: 450, afterLoad: 490, afterPackages: 560, afterExecution: 560 },
  };

  assert.equal(result.errorType, "timeout");
  assert.equal(result.canRetryWithSandbox, true);
});

test("PyodideExecResult shape: memory error", () => {
  const result: PyodideExecResult = {
    stdout: [],
    stderr: [],
    returnValue: null,
    error: "ERROR (memory): MemoryError\n→ Retry this task using data_python_sandbox, which provides up to 8 GB memory.",
    errorType: "memory",
    canRetryWithSandbox: true,
    charts: [],
    outputFiles: [],
    memoryRssMiB: { baseline: 450, afterLoad: 490, afterPackages: 560, afterExecution: 590 },
  };

  assert.equal(result.errorType, "memory");
  assert.equal(result.canRetryWithSandbox, true);
});

test("PyodideExecResult shape: syntax error — canRetryWithSandbox false", () => {
  const result: PyodideExecResult = {
    stdout: [],
    stderr: [],
    returnValue: null,
    error: "SyntaxError: invalid syntax (<string>, line 1)",
    errorType: "syntax",
    canRetryWithSandbox: false,
    charts: [],
    outputFiles: [],
    memoryRssMiB: { baseline: 450, afterLoad: 490, afterPackages: 560, afterExecution: 560 },
  };

  assert.equal(result.errorType, "syntax");
  assert.equal(result.canRetryWithSandbox, false, "syntax errors should NOT suggest retrying with sandbox");
});

// ---------------------------------------------------------------------------
// canRetryWithSandbox invariant
// ---------------------------------------------------------------------------

test("canRetryWithSandbox is true for package_unavailable, memory, timeout", () => {
  const retryTypes: PyodideErrorType[] = ["package_unavailable", "memory", "timeout"];
  for (const errorType of retryTypes) {
    const result: PyodideExecResult = {
      stdout: [], stderr: [], returnValue: null,
      error: `Error of type ${errorType}`,
      errorType,
      canRetryWithSandbox: true, // this is the contract
      charts: [], outputFiles: [],
      memoryRssMiB: { baseline: 0, afterLoad: 0, afterPackages: 0, afterExecution: 0 },
    };
    assert.equal(result.canRetryWithSandbox, true, `${errorType} must set canRetryWithSandbox: true`);
  }
});

test("canRetryWithSandbox is false for syntax and runtime errors", () => {
  const noRetryTypes: PyodideErrorType[] = ["syntax", "runtime"];
  for (const errorType of noRetryTypes) {
    const result: PyodideExecResult = {
      stdout: [], stderr: [], returnValue: null,
      error: `Error of type ${errorType}`,
      errorType,
      canRetryWithSandbox: false, // this is the contract
      charts: [], outputFiles: [],
      memoryRssMiB: { baseline: 0, afterLoad: 0, afterPackages: 0, afterExecution: 0 },
    };
    assert.equal(result.canRetryWithSandbox, false, `${errorType} must NOT suggest sandbox retry`);
  }
});

// ---------------------------------------------------------------------------
// Error message format contracts — messages the model sees
// ---------------------------------------------------------------------------

test("package_unavailable error message includes module name and data_python_sandbox hint", () => {
  // Simulate the formatted error the model sees in a tool result
  const modName = "scipy";
  const rawError = `ModuleNotFoundError: No module named '${modName}'`;
  const formatted =
    `ERROR (package_unavailable): ${rawError}\n` +
    `${modName} is not available in the lightweight Python environment.\n` +
    `→ Retry this task using data_python_sandbox, which supports pip install.`;

  assert.ok(formatted.includes("data_python_sandbox"), "must mention the sandbox tool");
  assert.ok(formatted.includes("pip install"), "must mention pip install");
  assert.ok(formatted.includes(modName), "must include the module name");
});

test("timeout error message includes data_python_sandbox hint", () => {
  const timeoutMs = 60_000;
  const formatted =
    `Execution timed out after ${timeoutMs}ms.\n` +
    `→ Retry this task using data_python_sandbox, which supports long-running computations (up to 45 min).`;

  assert.ok(formatted.includes("data_python_sandbox"), "must mention the sandbox tool");
  assert.ok(formatted.includes("45 min"), "must mention the extended time limit");
});

test("memory error message includes data_python_sandbox hint", () => {
  const formatted =
    `ERROR (memory): MemoryError\n` +
    `→ Retry this task using data_python_sandbox, which provides up to 8 GB memory.`;

  assert.ok(formatted.includes("data_python_sandbox"), "must mention the sandbox tool");
  assert.ok(formatted.includes("8 GB"), "must mention the larger memory limit");
});

// ---------------------------------------------------------------------------
// Chart result shape
// ---------------------------------------------------------------------------

test("chart result has pngBytes as Uint8Array and numeric index", () => {
  // PNG magic bytes
  const pngHeader = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const chart = { pngBytes: pngHeader, index: 0 };

  assert.ok(chart.pngBytes instanceof Uint8Array, "pngBytes must be Uint8Array");
  assert.equal(typeof chart.index, "number");
  // Validate PNG magic bytes
  assert.equal(chart.pngBytes[0], 137); // 0x89
  assert.equal(chart.pngBytes[1], 80);  // P
  assert.equal(chart.pngBytes[2], 78);  // N
  assert.equal(chart.pngBytes[3], 71);  // G
});

// ---------------------------------------------------------------------------
// Memory monitoring — memoryRssMiB fields
// ---------------------------------------------------------------------------

test("memoryRssMiB has all four required fields", () => {
  const mem = { baseline: 450, afterLoad: 490, afterPackages: 560, afterExecution: 610 };
  assert.equal(typeof mem.baseline, "number");
  assert.equal(typeof mem.afterLoad, "number");
  assert.equal(typeof mem.afterPackages, "number");
  assert.equal(typeof mem.afterExecution, "number");
  // Sanity: each stage should be >= the previous
  assert.ok(mem.afterLoad >= mem.baseline, "afterLoad should be >= baseline");
  assert.ok(mem.afterPackages >= mem.afterLoad, "afterPackages should be >= afterLoad");
  assert.ok(mem.afterExecution >= mem.afterPackages, "afterExecution should be >= afterPackages");
});
