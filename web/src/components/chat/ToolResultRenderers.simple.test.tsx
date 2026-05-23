import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceExportFileResult } from "./ToolResultRenderers.simple";
import { safeHttpUrl } from "./ToolResultRenderers.simple.utils";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("WorkspaceExportFileResult", () => {
  it("renders only http and https download links", () => {
    const { rerender } = render(
      <WorkspaceExportFileResult
        data={{ filename: "report.csv", downloadUrl: "javascript:alert(1)" }}
      />,
    );

    expect(screen.queryByRole("link", { name: "download" })).not.toBeInTheDocument();

    rerender(
      <WorkspaceExportFileResult
        data={{ filename: "report.csv", downloadUrl: "https://downloads.example.com/report.csv" }}
      />,
    );

    expect(screen.getByRole("link", { name: "download" })).toHaveAttribute(
      "href",
      "https://downloads.example.com/report.csv",
    );
  });

  it("normalizes relative download URLs against the app origin", () => {
    expect(safeHttpUrl("/download?storageId=abc")).toBe("http://localhost:3000/download?storageId=abc");
    expect(safeHttpUrl("data:text/html,boom")).toBeNull();
  });
});
