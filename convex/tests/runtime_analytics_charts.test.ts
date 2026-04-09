import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChartFromPngBytes,
  buildChartDataArtifact,
  buildChartPreviewArtifact,
  toFiniteNumber,
} from "../runtime/service_analytics_charts";

// ---------------------------------------------------------------------------
// buildChartFromPngBytes
// ---------------------------------------------------------------------------

test("buildChartFromPngBytes returns null for empty bytes", () => {
  const result = buildChartFromPngBytes(new Uint8Array(0), 0);
  assert.equal(result, null);
});

test("buildChartFromPngBytes produces a png_image chart", () => {
  const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic
  const chart = buildChartFromPngBytes(pngBytes, 0);

  assert.ok(chart !== null);
  assert.equal(chart!.chartType, "png_image");
  assert.equal(chart!.toolName, "data_python_exec");
  assert.ok(typeof chart!.pngBase64 === "string");
  assert.ok(chart!.pngBase64!.length > 0, "pngBase64 should be non-empty");
  assert.deepEqual(chart!.elements, []);
});

test("buildChartFromPngBytes uses filename as title when provided", () => {
  const pngBytes = new Uint8Array([1, 2, 3]);
  const chart = buildChartFromPngBytes(pngBytes, 2, "revenue-chart.png");

  assert.ok(chart !== null);
  assert.equal(chart!.title, "revenue chart");
});

test("buildChartFromPngBytes falls back to index-based title without filename", () => {
  const pngBytes = new Uint8Array([1, 2, 3]);
  const chart = buildChartFromPngBytes(pngBytes, 3);

  assert.ok(chart !== null);
  assert.equal(chart!.title, "Chart 4");
});

test("buildChartFromPngBytes accepts custom toolName", () => {
  const pngBytes = new Uint8Array([1, 2, 3]);
  const chart = buildChartFromPngBytes(pngBytes, 0, undefined, "data_python_sandbox");
  assert.ok(chart !== null);
  assert.equal(chart!.toolName, "data_python_sandbox");
});

// ---------------------------------------------------------------------------
// buildChartDataArtifact
// ---------------------------------------------------------------------------

test("buildChartDataArtifact returns null for png_image charts (no structured data)", () => {
  const artifact = buildChartDataArtifact(
    { toolName: "data_python_exec", chartType: "png_image", elements: [], pngBase64: "abc" },
    0,
  );
  assert.equal(artifact, null);
});

test("buildChartDataArtifact produces csv for pie charts", async () => {
  const artifact = buildChartDataArtifact(
    {
      toolName: "data_python_exec",
      chartType: "pie",
      title: "Share",
      elements: [
        { label: "A", value: 60 },
        { label: "B", value: 40 },
      ],
    },
    1,
  );

  assert.ok(artifact);
  assert.equal(artifact?.filename, "share.csv");
  assert.equal(artifact?.mimeType, "text/csv");
  const contents = await artifact?.blob.text();
  assert.equal(contents, "label,value\nA,60\nB,40");
});

test("buildChartDataArtifact produces csv for line charts", async () => {
  const artifact = buildChartDataArtifact(
    {
      toolName: "data_python_exec",
      chartType: "line",
      title: "Trend",
      xLabel: "Month",
      yLabel: "Value",
      elements: [
        { x: "Jan", y: 1, group: "Series A" },
        { x: "Feb", y: 2, group: "Series A" },
      ],
    },
    0,
  );

  assert.ok(artifact);
  assert.equal(artifact?.filename, "trend.csv");
  const contents = await artifact?.blob.text();
  assert.ok(contents?.includes("x,y,group"));
  assert.ok(contents?.includes("Jan,1,Series A"));
});

test("buildChartDataArtifact produces csv for bar charts", async () => {
  const artifact = buildChartDataArtifact(
    {
      toolName: "data_python_exec",
      chartType: "bar",
      title: "Sales",
      elements: [
        { label: "Q1", value: 100, group: "North" },
        { label: "Q2", value: 200, group: "North" },
      ],
    },
    0,
  );

  assert.ok(artifact);
  const contents = await artifact?.blob.text();
  assert.ok(contents?.includes("label,value,group"));
  assert.ok(contents?.includes("Q1,100,North"));
});

// ---------------------------------------------------------------------------
// buildChartPreviewArtifact
// ---------------------------------------------------------------------------

test("buildChartPreviewArtifact wraps Uint8Array as image/png blob", () => {
  const pngBytes = new Uint8Array([137, 80, 78, 71]);
  const artifact = buildChartPreviewArtifact(pngBytes, 0);
  assert.equal(artifact.mimeType, "image/png");
  assert.ok(artifact.filename.endsWith(".png"));
});

test("buildChartPreviewArtifact decodes base64 string input", () => {
  // "PNG" as base64
  const artifact = buildChartPreviewArtifact("UE5H", 1);
  assert.equal(artifact.mimeType, "image/png");
  assert.ok(artifact.filename.endsWith(".png"));
});

test("buildChartPreviewArtifact uses title in filename when provided", () => {
  const artifact = buildChartPreviewArtifact(new Uint8Array([1]), 0, "Revenue Over Time");
  assert.ok(artifact.filename.includes("revenue"), `filename: ${artifact.filename}`);
});

// ---------------------------------------------------------------------------
// toFiniteNumber helper
// ---------------------------------------------------------------------------

test("toFiniteNumber converts numeric strings", () => {
  assert.equal(toFiniteNumber("3.14"), 3.14);
  assert.equal(toFiniteNumber("100"), 100);
});

test("toFiniteNumber returns null for non-numeric values", () => {
  assert.equal(toFiniteNumber("abc"), null);
  assert.equal(toFiniteNumber(NaN), null);
  assert.equal(toFiniteNumber(Infinity), null);
  assert.equal(toFiniteNumber(undefined), null);
});
