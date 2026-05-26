import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { GeneratedChartsCard } from "./GeneratedChartsCard";
import { parseBoxes } from "./GeneratedChartsCard.data";
import type { Id } from "@convex/_generated/dataModel";

vi.mock("convex/react", () => ({
  useQuery: () => [
    {
      _id: "chart_1",
      chartType: "bar",
      title: "Revenue",
      xLabel: "Region",
      yLabel: "USD",
      elements: [{ label: "NA", value: 42 }],
    },
  ],
}));

describe("GeneratedChartsCard", () => {
  test("chart controls do not submit an enclosing form", () => {
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <GeneratedChartsCard messageId={"messages_1" as Id<"messages">} />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand chart" }));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close chart" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("box parser coerces non-numeric values before rendering", () => {
    expect(parseBoxes([
      { label: "Latency", min: "bad", q1: 1, median: Number.NaN, q3: 3, max: 4, outliers: [5, "bad"] },
    ])).toEqual([
      { label: "Latency", min: 0, q1: 1, median: 0, q3: 3, max: 4, outliers: [5, 0] },
    ]);
  });
});
