import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderToolResult } from "./ToolResultRenderers.router";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("renderToolResult", () => {
  it("returns null for unknown tools, invalid JSON, and failed tool payloads", () => {
    expect(renderToolResult("unknown_tool", "{}")).toBeNull();
    expect(renderToolResult("workspace_reset", "{bad json")).toBeNull();
    expect(renderToolResult("workspace_reset", JSON.stringify({ success: false }))).toBeNull();
  });

  it("routes sandbox and workspace payloads to structured renderers", () => {
    const { rerender } = render(
      renderToolResult("workspace_reset", JSON.stringify({ data: { cwd: "/repo" } })),
    );

    expect(screen.getByText("workspace_reset_label")).toBeInTheDocument();
    expect(screen.getByText("/repo")).toBeInTheDocument();

    rerender(renderToolResult("data_python_sandbox", JSON.stringify({
      data: {
        resultsSummary: "analysis complete",
        chartsCreated: 2,
        exportedFiles: ["report.csv"],
        importedFiles: ["input.csv"],
        warnings: ["missing values filled"],
      },
    })));

    expect(screen.getByText("analysis complete")).toBeInTheDocument();
    expect(screen.getByText("2 charts")).toBeInTheDocument();
    expect(screen.getByText("1 export")).toBeInTheDocument();
    expect(screen.getByText("1 import")).toBeInTheDocument();
    expect(screen.getByText("missing values filled")).toBeInTheDocument();
  });
});
