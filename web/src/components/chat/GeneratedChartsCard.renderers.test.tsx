import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  BarChartRenderer,
  BoxChartRenderer,
  LineChartRenderer,
  PieChartRenderer,
  ScatterChartRenderer,
} from "./GeneratedChartsCard.renderers";

vi.mock("recharts", () => {
  type MockChartProps = Record<string, unknown> & { children?: React.ReactNode };
  const make =
    (name: string) =>
    ({ children, data, name: seriesName, dataKey, fill, stroke, shape }: MockChartProps) => (
      <div data-testid={name} data-name={String(seriesName ?? "")} data-key={String(dataKey ?? "")} data-fill={String(fill ?? "")} data-stroke={String(stroke ?? "")}>
        {seriesName != null && <span>{String(seriesName)}</span>}
        {Array.isArray(data) && <span data-testid={`${name}-rows`}>{data.length}</span>}
        {React.isValidElement(shape) && (
          <svg>
            {React.cloneElement(shape, {
              x: 10,
              y: 20,
              width: 40,
              height: 80,
              payload: { q1: 10, median: 15, q3: 20 },
            } as Record<string, unknown>)}
          </svg>
        )}
        {children}
      </div>
    );

  return {
    ResponsiveContainer: make("ResponsiveContainer"),
    LineChart: make("LineChart"),
    Line: make("Line"),
    BarChart: make("BarChart"),
    Bar: make("Bar"),
    ScatterChart: make("ScatterChart"),
    Scatter: make("Scatter"),
    PieChart: make("PieChart"),
    Pie: make("Pie"),
    Cell: make("Cell"),
    ComposedChart: make("ComposedChart"),
    XAxis: make("XAxis"),
    YAxis: make("YAxis"),
    CartesianGrid: make("CartesianGrid"),
    Tooltip: make("Tooltip"),
    Legend: make("Legend"),
    Rectangle: make("Rectangle"),
  };
});

describe("Generated chart renderers", () => {
  it("splits grouped line, bar, and scatter series into named chart primitives", () => {
    render(
      <>
        <LineChartRenderer
          points={[
            { x: "Jan", y: 1, group: "actual" },
            { x: "Jan", y: 2, group: "forecast" },
          ]}
          xLabel="Month"
          yLabel="USD"
        />
        <BarChartRenderer
          bars={[
            { label: "NA", value: 5, group: "direct" },
            { label: "NA", value: 7, group: "partner" },
          ]}
        />
        <ScatterChartRenderer
          points={[
            { x: 1, y: 10, group: "team A" },
            { x: 2, y: 20, group: "team B" },
          ]}
        />
      </>,
    );

    expect(screen.getByTestId("LineChart-rows")).toHaveTextContent("1");
    expect(screen.getByTestId("BarChart-rows")).toHaveTextContent("1");
    expect(screen.getByText("actual")).toBeInTheDocument();
    expect(screen.getByText("forecast")).toBeInTheDocument();
    expect(screen.getByText("direct")).toBeInTheDocument();
    expect(screen.getByText("partner")).toBeInTheDocument();
    expect(screen.getByText("team A")).toBeInTheDocument();
    expect(screen.getByText("team B")).toBeInTheDocument();
  });

  it("renders single-series, pie slices, and box plot shapes", () => {
    render(
      <>
        <LineChartRenderer points={[{ x: "Jan", y: 1 }]} />
        <BarChartRenderer bars={[{ label: "NA", value: 5 }]} />
        <ScatterChartRenderer points={[{ x: "A", y: 10 }]} />
        <PieChartRenderer slices={[{ label: "Core", value: 70 }, { label: "Edge", value: 30 }]} />
        <BoxChartRenderer boxes={[{ label: "Latency", min: 1, q1: 2, median: 3, q3: 4, max: 5, outliers: [9] }]} />
      </>,
    );

    expect(screen.getAllByTestId("Line")).toHaveLength(1);
    expect(screen.getAllByTestId("Cell")).toHaveLength(2);
    expect(screen.getAllByTestId("Scatter").some((node) => node.textContent === "1")).toBe(true);
    expect(screen.getAllByTestId("Rectangle")).toHaveLength(1);
    expect(document.querySelectorAll("line")).toHaveLength(4);
  });
});
