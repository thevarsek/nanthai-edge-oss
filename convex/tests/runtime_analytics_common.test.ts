import assert from "node:assert/strict";
import test from "node:test";

import {
  processCharts,
  processOutputFiles,
  buildResultSummary,
  type ChartInput,
  type OutputFileInput,
  type StoredFileEntry,
  type ProcessingDeps,
} from "../runtime/service_analytics_common";
import {
  RUNTIME_MAX_CHARTS_PER_TOOL_CALL,
  RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL,
} from "../runtime/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toolCtx = {} as any;

function makeDeps(overrides?: Partial<ProcessingDeps>): ProcessingDeps {
  return {
    storeArtifactBytes: overrides?.storeArtifactBytes ?? (async (_ctx, bytes, filename, mimeType) => ({
      storageId: `store_${filename}`,
      filename,
      mimeType,
      sizeBytes: bytes.byteLength,
      downloadUrl: `https://example.com/${filename}`,
    })),
    buildChartPreviewArtifact: overrides?.buildChartPreviewArtifact ?? ((pngBytes, index) => ({
      filename: `chart_${index}.png`,
      mimeType: "image/png" as const,
      bytes: pngBytes instanceof Uint8Array ? pngBytes : new Uint8Array(Buffer.from(pngBytes, "base64")),
      blob: new Blob(),
    })),
  };
}

function makeChartInputs(count: number): ChartInput[] {
  return Array.from({ length: count }, (_, i) => ({
    pngBytes: new Uint8Array([137, 80, 78, 71, i]),
    index: i,
  }));
}

function makeOutputFileInputs(count: number): OutputFileInput[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `/outputs/file_${i}.csv`,
    bytes: new Uint8Array([i, i + 1, i + 2]),
    mimeType: "text/csv",
  }));
}

// ---------------------------------------------------------------------------
// processCharts
// ---------------------------------------------------------------------------

test("processCharts stores chart PNGs via storeArtifactBytes and appends to exportedFiles", async () => {
  const charts = makeChartInputs(3);
  const exportedFiles: StoredFileEntry[] = [];
  const warnings: string[] = [];
  const deps = makeDeps();

  await processCharts(toolCtx, charts, exportedFiles, warnings, deps);

  assert.equal(exportedFiles.length, 3);
  assert.equal(warnings.length, 0);

  for (let i = 0; i < 3; i++) {
    const entry = exportedFiles[i];
    assert.equal(entry.storageId, `store_chart_${i}.png`);
    assert.equal(entry.filename, `chart_${i}.png`);
    assert.equal(entry.mimeType, "image/png");
    assert.equal(entry.sizeBytes, 5); // 5-byte Uint8Array
    assert.equal(entry.downloadUrl, `https://example.com/chart_${i}.png`);
    // Chart entries have no `path` field
    assert.equal(entry.path, undefined);
  }
});

test("processCharts caps at RUNTIME_MAX_CHARTS_PER_TOOL_CALL", async () => {
  const charts = makeChartInputs(RUNTIME_MAX_CHARTS_PER_TOOL_CALL + 3);
  const exportedFiles: StoredFileEntry[] = [];
  const warnings: string[] = [];
  const deps = makeDeps();

  await processCharts(toolCtx, charts, exportedFiles, warnings, deps);

  assert.equal(exportedFiles.length, RUNTIME_MAX_CHARTS_PER_TOOL_CALL);
  assert.equal(warnings.length, 0);
});

test("processCharts adds warning when storeArtifactBytes throws", async () => {
  const charts = makeChartInputs(2);
  const exportedFiles: StoredFileEntry[] = [];
  const warnings: string[] = [];
  let callCount = 0;
  const deps = makeDeps({
    storeArtifactBytes: async (_ctx, bytes, filename, mimeType) => {
      callCount++;
      if (callCount === 1) throw new Error("Storage unavailable");
      return { storageId: "ok", filename, mimeType, sizeBytes: bytes.byteLength, downloadUrl: null };
    },
  });

  await processCharts(toolCtx, charts, exportedFiles, warnings, deps);

  // First chart failed, second succeeded
  assert.equal(exportedFiles.length, 1);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("Failed to store chart 0"));
  assert.ok(warnings[0].includes("Storage unavailable"));
});

// ---------------------------------------------------------------------------
// processOutputFiles
// ---------------------------------------------------------------------------

test("processOutputFiles stores output files via storeArtifactBytes and appends to exportedFiles", async () => {
  const outputFiles = makeOutputFileInputs(3);
  const exportedFiles: StoredFileEntry[] = [];
  const warnings: string[] = [];
  const deps = makeDeps();

  await processOutputFiles(toolCtx, outputFiles, exportedFiles, warnings, deps);

  assert.equal(exportedFiles.length, 3);
  assert.equal(warnings.length, 0);

  for (let i = 0; i < 3; i++) {
    const entry = exportedFiles[i];
    assert.equal(entry.storageId, `store_file_${i}.csv`);
    assert.equal(entry.path, `/outputs/file_${i}.csv`);
    assert.equal(entry.filename, `file_${i}.csv`);
    assert.equal(entry.mimeType, "text/csv");
    assert.equal(entry.sizeBytes, 3); // 3-byte Uint8Array
    assert.ok(entry.downloadUrl);
  }
});

test("processOutputFiles respects remaining budget (RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL minus existing)", async () => {
  // Pre-fill with 8 entries, leaving budget for 2 more
  const existingFiles: StoredFileEntry[] = Array.from({ length: 8 }, (_, i) => ({
    storageId: `existing_${i}`,
    mimeType: "image/png",
    sizeBytes: 100,
  }));
  const outputFiles = makeOutputFileInputs(5); // request 5, but only 2 should be stored
  const warnings: string[] = [];
  const deps = makeDeps();

  await processOutputFiles(toolCtx, outputFiles, existingFiles, warnings, deps);

  // 8 existing + 2 new = 10
  assert.equal(existingFiles.length, RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL);
  assert.ok(warnings.length > 0, "Should warn about exceeding limit");
  assert.ok(warnings[0].includes("Only 2 of 5"));
});

test("processOutputFiles adds warning when exceeding limit", async () => {
  // Fill up to the limit so budget is 0
  const existingFiles: StoredFileEntry[] = Array.from(
    { length: RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL },
    () => ({ mimeType: "text/plain", sizeBytes: 10 }),
  );
  const outputFiles = makeOutputFileInputs(3);
  const warnings: string[] = [];
  const deps = makeDeps();

  await processOutputFiles(toolCtx, outputFiles, existingFiles, warnings, deps);

  // No new files should be stored
  assert.equal(existingFiles.length, RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("Only 0 of 3"));
  assert.ok(warnings[0].includes(`limit: ${RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL}`));
});

test("processOutputFiles adds warning when storeArtifactBytes throws but still appends partial entry", async () => {
  const outputFiles = makeOutputFileInputs(1);
  const exportedFiles: StoredFileEntry[] = [];
  const warnings: string[] = [];
  const deps = makeDeps({
    storeArtifactBytes: async () => {
      throw new Error("Disk full");
    },
  });

  await processOutputFiles(toolCtx, outputFiles, exportedFiles, warnings, deps);

  // Partial entry should still be appended (without storageId/downloadUrl)
  assert.equal(exportedFiles.length, 1);
  assert.equal(exportedFiles[0].path, "/outputs/file_0.csv");
  assert.equal(exportedFiles[0].mimeType, "text/csv");
  assert.equal(exportedFiles[0].sizeBytes, 3);
  assert.equal(exportedFiles[0].storageId, undefined);
  assert.equal(exportedFiles[0].downloadUrl, undefined);

  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("Failed to store export /outputs/file_0.csv"));
  assert.ok(warnings[0].includes("Disk full"));
});

// ---------------------------------------------------------------------------
// buildResultSummary
// ---------------------------------------------------------------------------

test("buildResultSummary includes stdout text (string[] form)", () => {
  const result = buildResultSummary(["hello", "world"], [], 0, [], []);
  assert.ok(result.some((line) => line.includes("hello") && line.includes("world")));
});

test("buildResultSummary includes stdout text (string form - Vercel returns string)", () => {
  const result = buildResultSummary("single string output", [], 0, [], []);
  assert.ok(result.some((line) => line.includes("single string output")));
});

test("buildResultSummary includes stderr with prefix", () => {
  const result = buildResultSummary([], ["error msg"], 0, [], []);
  assert.ok(result.some((line) => line.startsWith("stderr:") && line.includes("error msg")));
});

test("buildResultSummary includes chart count line", () => {
  const result = buildResultSummary([], [], 3, [], []);
  assert.ok(result.some((line) => line.includes("3 chart(s) generated")));
});

test("buildResultSummary includes file export line with filenames", () => {
  const files: StoredFileEntry[] = [
    { path: "/outputs/data.csv", filename: "data.csv", mimeType: "text/csv", sizeBytes: 100 },
    { path: "/outputs/report.json", filename: "report.json", mimeType: "application/json", sizeBytes: 200 },
  ];
  const result = buildResultSummary([], [], 0, files, []);
  assert.ok(result.some((line) => line.includes("2 file(s) exported")));
  assert.ok(result.some((line) => line.includes("data.csv") && line.includes("report.json")));
});

test("buildResultSummary filters out chart PNGs from file count (entries without path field)", () => {
  const files: StoredFileEntry[] = [
    // Chart entry (no path, image/png) — should be excluded from file count
    { storageId: "s1", filename: "chart_0.png", mimeType: "image/png", sizeBytes: 5000 },
    // Output file with path — should be counted
    { storageId: "s2", path: "/outputs/result.csv", filename: "result.csv", mimeType: "text/csv", sizeBytes: 100 },
    // PNG with path (from processOutputFiles, not a chart) — should be counted
    { storageId: "s3", path: "/outputs/screenshot.png", filename: "screenshot.png", mimeType: "image/png", sizeBytes: 8000 },
  ];
  const result = buildResultSummary([], [], 1, files, []);

  // Should report 1 chart and 2 files (not 3)
  assert.ok(result.some((line) => line.includes("1 chart(s) generated")));
  assert.ok(result.some((line) => line.includes("2 file(s) exported")));
  assert.ok(result.some((line) => line.includes("result.csv") && line.includes("screenshot.png")));
  // chart_0.png should NOT appear in the file export line
  const fileLine = result.find((line) => line.includes("file(s) exported"));
  assert.ok(fileLine);
  assert.ok(!fileLine!.includes("chart_0.png"), "chart PNG should be filtered from file list");
});

test("buildResultSummary includes warnings section", () => {
  const result = buildResultSummary([], [], 0, [], ["warn1", "warn2"]);
  assert.ok(result.some((line) => line.startsWith("Warnings:")));
  assert.ok(result.some((line) => line.includes("warn1") && line.includes("warn2")));
});

test("buildResultSummary returns empty array when everything is empty", () => {
  const result = buildResultSummary([], [], 0, [], []);
  assert.deepEqual(result, []);
});
