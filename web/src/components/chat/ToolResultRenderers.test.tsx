import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DataPythonExecResult,
  WorkspaceExecResult,
  WorkspaceListFilesResult,
  WorkspaceReadFileResult,
} from "./ToolResultRenderers";

describe("ToolResultRenderers", () => {
  it("renders workspace exec status, output streams, duration, and cwd", () => {
    render(
      <WorkspaceExecResult
        data={{
          data: {
            stdout: "build passed",
            stderr: "warning: slow",
            exitCode: 0,
            durationMs: 1234,
            cwd: "/workspace/app",
          },
        }}
      />,
    );

    expect(screen.getByText("exit 0")).toBeInTheDocument();
    expect(screen.getByText("1.23s")).toBeInTheDocument();
    expect(screen.getByText("/workspace/app")).toBeInTheDocument();
    expect(screen.getByText("build passed")).toBeInTheDocument();
    expect(screen.getByText("warning: slow")).toBeInTheDocument();
  });

  it("renders no-output and empty-directory states from bare tool payloads", () => {
    const { rerender } = render(<WorkspaceExecResult data={{ exitCode: 1 }} />);
    expect(screen.getByText("exit 1")).toBeInTheDocument();
    expect(screen.getByText("No output")).toBeInTheDocument();

    rerender(<WorkspaceListFilesResult data={{ root: "/workspace", files: [] }} />);
    expect(screen.getByText("/workspace")).toBeInTheDocument();
    expect(screen.getByText("Empty directory")).toBeInTheDocument();
    expect(screen.getByText("0 items")).toBeInTheDocument();
  });

  it("renders listed files with count labels", () => {
    render(
      <WorkspaceListFilesResult
        data={{
          files: [
            { type: "dir", path: "src" },
            { type: "file", path: "package.json" },
          ],
        }}
      />,
    );

    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.getByText("package.json")).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeInTheDocument();
  });

  it("renders text, binary, and empty read-file payloads", () => {
    const { rerender } = render(
      <WorkspaceReadFileResult
        data={{
          path: "src/main.ts",
          content: "console.log('ok')",
          mimeType: "text/typescript",
          sizeBytes: 2048,
          truncated: true,
        }}
      />,
    );

    expect(screen.getByText("src/main.ts")).toBeInTheDocument();
    expect(screen.getByText("text/typescript")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("truncated")).toBeInTheDocument();
    expect(screen.getByText("console.log('ok')")).toBeInTheDocument();

    rerender(<WorkspaceReadFileResult data={{ isBinary: true }} />);
    expect(screen.getByText(/Binary file/)).toBeInTheDocument();

    rerender(<WorkspaceReadFileResult data={{ path: "empty.txt" }} />);
    expect(screen.getByText("No content")).toBeInTheDocument();
  });

  it("renders Python result summaries, logs, import/export counts, and warnings", () => {
    const { rerender } = render(
      <DataPythonExecResult
        data={{
          text: "rows=10",
          logs: { stdout: "loaded csv", stderr: "dropped nulls" },
          chartsCreated: 2,
          exportedFiles: ["out.csv", "plot.png"],
          importedFiles: ["source.csv"],
          warnings: ["missing column"],
        }}
      />,
    );

    expect(screen.getByText("Python")).toBeInTheDocument();
    expect(screen.getByText("2 charts")).toBeInTheDocument();
    expect(screen.getByText("2 exports")).toBeInTheDocument();
    expect(screen.getByText("1 import")).toBeInTheDocument();
    expect(screen.getByText("rows=10")).toBeInTheDocument();
    expect(screen.getByText("loaded csv")).toBeInTheDocument();
    expect(screen.getByText("dropped nulls")).toBeInTheDocument();
    expect(screen.getByText("missing column")).toBeInTheDocument();

    rerender(<DataPythonExecResult data={{ resultsSummary: "summary only", chartsCreated: 1 }} />);
    expect(screen.getByText("1 chart")).toBeInTheDocument();
    expect(screen.getByText("summary only")).toBeInTheDocument();
  });
});
