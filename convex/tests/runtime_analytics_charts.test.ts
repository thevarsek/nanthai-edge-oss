import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChartDataArtifact,
  normalizeE2BChart,
} from "../runtime/service_analytics_charts";

test("normalizeE2BChart converts line charts to point rows", () => {
  const chart = normalizeE2BChart({
    type: "line",
    title: "Trend",
    x_label: "Month",
    y_label: "Value",
    elements: [
      {
        label: "Series A",
        points: [["Jan", 1], ["Feb", 2]],
      },
    ],
  });

  assert.deepEqual(chart, {
    toolName: "data_python_exec",
    chartType: "line",
    title: "Trend",
    xLabel: "Month",
    yLabel: "Value",
    xUnit: undefined,
    yUnit: undefined,
    elements: [
      { x: "Jan", y: 1, group: "Series A" },
      { x: "Feb", y: 2, group: "Series A" },
    ],
  });
});

test("buildChartDataArtifact produces csv for pie charts", async () => {
  const artifact = buildChartDataArtifact({
    toolName: "data_python_exec",
    chartType: "pie",
    title: "Share",
    elements: [
      { label: "A", value: 60 },
      { label: "B", value: 40 },
    ],
  }, 1);

  assert.ok(artifact);
  assert.equal(artifact?.filename, "share.csv");
  assert.equal(artifact?.mimeType, "text/csv");
  const contents = await artifact?.blob.text();
  assert.equal(contents, "label,value\nA,60\nB,40");
});
