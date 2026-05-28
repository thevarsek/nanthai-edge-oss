import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceExportFileResult,
  WorkspaceImportFileResult,
  WorkspaceMakeDirsResult,
  WorkspaceResetResult,
  WorkspaceWriteFileResult,
} from "./ToolResultRenderers.simple";
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

  it("renders write, directory, import, and reset payload variants", () => {
    const { rerender } = render(
      <WorkspaceWriteFileResult data={{ data: { path: "src/report.md", bytesWritten: 1536 } }} />,
    );

    expect(screen.getByText("src/report.md")).toBeInTheDocument();
    expect(screen.getByText("1.5 KB")).toBeInTheDocument();

    rerender(<WorkspaceMakeDirsResult data={{ path: "dist/assets", created: true }} />);
    expect(screen.getByText("dist/assets")).toBeInTheDocument();
    expect(screen.getByText("created")).toBeInTheDocument();

    rerender(<WorkspaceImportFileResult data={{ filename: "source.pdf", mimeType: "application/pdf", sizeBytes: 1024 * 1024 }} />);
    expect(screen.getByText("source.pdf")).toBeInTheDocument();
    expect(screen.getByText("application/pdf")).toBeInTheDocument();
    expect(screen.getByText("1.0 MB")).toBeInTheDocument();

    rerender(<WorkspaceResetResult data={{ data: { cwd: "/workspace" } }} />);
    expect(screen.getByText("workspace_reset_label")).toBeInTheDocument();
    expect(screen.getByText("/workspace")).toBeInTheDocument();
  });

  it("renders fallback shapes without optional badges or unsafe links", () => {
    const { rerender } = render(
      <WorkspaceWriteFileResult data={{ path: "plain.txt" }} />,
    );

    expect(screen.getByText("plain.txt")).toBeInTheDocument();
    expect(screen.queryByText(/KB|MB|bytes/)).not.toBeInTheDocument();

    rerender(<WorkspaceMakeDirsResult data={{ data: { path: "already-there", created: false } }} />);
    expect(screen.getByText("already-there")).toBeInTheDocument();
    expect(screen.queryByText("created")).not.toBeInTheDocument();

    rerender(<WorkspaceExportFileResult data={{ filename: "unsafe.html", downloadUrl: "javascript:alert(1)" }} />);
    expect(screen.getByText("unsafe.html")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "download" })).not.toBeInTheDocument();

    rerender(<WorkspaceImportFileResult data={{ path: "/tmp/input.txt" }} />);
    expect(screen.getByText("/tmp/input.txt")).toBeInTheDocument();

    rerender(<WorkspaceResetResult data={{}} />);
    expect(screen.getByText("workspace_reset_label")).toBeInTheDocument();
    expect(screen.queryByText("/workspace")).not.toBeInTheDocument();
  });
});
