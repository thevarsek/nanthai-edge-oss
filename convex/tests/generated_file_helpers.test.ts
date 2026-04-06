import assert from "node:assert/strict";
import test from "node:test";

import { extractGeneratedCharts, extractGeneratedFiles } from "../chat/generated_file_helpers";

test("extractGeneratedFiles includes workspace exports", () => {
  const files = extractGeneratedFiles([
    {
      toolCallId: "call_1",
      toolName: "workspace_export_file",
      result: JSON.stringify({
        path: "/tmp/nanthai-edge/chat_1/sample_output.csv",
        filename: "sample_output.csv",
        storageId: "storage_1",
        mimeType: "text/csv",
        sizeBytes: 128,
      }),
    },
  ]);

  assert.deepEqual(files, [{
    storageId: "storage_1",
    filename: "sample_output.csv",
    mimeType: "text/csv",
    sizeBytes: 128,
    toolName: "workspace_export_file",
  }]);
});

test("extractGeneratedFiles falls back to extension-based mime type", () => {
  const files = extractGeneratedFiles([
    {
      toolCallId: "call_1",
      toolName: "workspace_export_file",
      result: JSON.stringify({
        filename: "notes.txt",
        storageId: "storage_2",
      }),
    },
  ]);

  assert.deepEqual(files, [{
    storageId: "storage_2",
    filename: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: undefined,
    toolName: "workspace_export_file",
  }]);
});

test("extractGeneratedFiles reads analytics exported files", () => {
  const files = extractGeneratedFiles([
    {
      toolCallId: "call_2",
      toolName: "data_python_exec",
      result: JSON.stringify({
        exportedFiles: [
          {
            storageId: "storage_chart_png",
            filename: "sales-chart.png",
            mimeType: "image/png",
            sizeBytes: 1024,
            toolName: "data_python_exec",
          },
          {
            storageId: "storage_chart_csv",
            filename: "sales-chart-data.csv",
            mimeType: "text/csv",
            sizeBytes: 256,
            toolName: "data_python_exec",
          },
        ],
      }),
    },
  ]);

  assert.equal(files.length, 2);
  assert.equal(files[0].filename, "sales-chart.png");
  assert.equal(files[1].filename, "sales-chart-data.csv");
});

test("extractGeneratedCharts reads analytics chart payloads", () => {
  const charts = extractGeneratedCharts([
    {
      toolCallId: "call_3",
      toolName: "data_python_exec",
      result: JSON.stringify({
        chartsCreated: [
          {
            chartType: "bar",
            title: "Revenue by Region",
            xLabel: "Region",
            yLabel: "Revenue",
            elements: [
              { label: "NA", value: 10, group: "2026" },
              { label: "EU", value: 8, group: "2026" },
            ],
          },
        ],
      }),
    },
  ]);

  assert.deepEqual(charts, [{
    toolName: "data_python_exec",
    chartType: "bar",
    title: "Revenue by Region",
    xLabel: "Region",
    yLabel: "Revenue",
    xUnit: undefined,
    yUnit: undefined,
    elements: [
      { label: "NA", value: 10, group: "2026" },
      { label: "EU", value: 8, group: "2026" },
    ],
  }]);
});
