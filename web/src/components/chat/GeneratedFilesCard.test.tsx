import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { GeneratedFilesCard } from "./GeneratedFilesCard";
import type { Id } from "@convex/_generated/dataModel";

vi.mock("convex/react", () => ({
  useQuery: () => [
    {
      _id: "generatedFiles_doc" as Id<"generatedFiles">,
      filename: "Agreement.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 128_000,
      downloadUrl: "https://example.test/download/agreement.docx",
      documentId: "documents_1",
      documentVersionId: "documentVersions_doc",
    },
    {
      _id: "generatedFiles_text" as Id<"generatedFiles">,
      filename: "notes.md",
      mimeType: "text/markdown",
      sizeBytes: 1_024,
      downloadUrl: "https://example.test/download/notes.md",
      documentId: "documents_text",
      documentVersionId: "documentVersions_text",
    },
    {
      _id: "generatedFiles_legacy_doc" as Id<"generatedFiles">,
      filename: "Legacy.doc",
      mimeType: "application/msword",
      sizeBytes: 64_000,
      downloadUrl: "https://example.test/download/legacy.doc",
      documentId: "documents_legacy",
      documentVersionId: "documentVersions_legacy",
    },
    {
      _id: "generatedFiles_pdf" as Id<"generatedFiles">,
      filename: "Contract.pdf",
      mimeType: "application/pdf",
      sizeBytes: 256_000,
      downloadUrl: "https://example.test/download/contract.pdf",
    },
    {
      _id: "generatedFiles_png" as Id<"generatedFiles">,
      filename: "chart.png",
      mimeType: "image/png",
      sizeBytes: 42_000,
      downloadUrl: "https://example.test/download/chart.png",
    },
    {
      _id: "generatedFiles_pending" as Id<"generatedFiles">,
      filename: "pending.csv",
      mimeType: "text/csv",
      sizeBytes: 24,
      downloadUrl: null,
    },
  ],
}));

describe("GeneratedFilesCard", () => {
  test("renders generated document and image affordances from seeded Convex data", () => {
    const onOpenFile = vi.fn();
    render(<GeneratedFilesCard messageId={"messages_1" as Id<"messages">} onOpenFile={onOpenFile} />);

    expect(screen.getByText("Agreement.docx")).toBeInTheDocument();
    expect(screen.getAllByText(/Saved document/).length).toBeGreaterThan(0);
    expect(screen.getByAltText("chart.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Agreement.docx/i }));
    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({
      file: expect.objectContaining({ filename: "Agreement.docx" }),
    }));
    fireEvent.click(screen.getByRole("button", { name: /notes.md/i }));
    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({
      file: expect.objectContaining({ filename: "notes.md" }),
    }));
    fireEvent.click(screen.getByRole("button", { name: /Contract.pdf/i }));
    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({
      file: expect.objectContaining({ filename: "Contract.pdf" }),
    }));
    expect(screen.queryByRole("button", { name: /Legacy.doc/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Legacy.doc/i })).toHaveAttribute(
      "href",
      "https://example.test/download/legacy.doc",
    );
    expect(screen.getByRole("link", { name: /Download Agreement.docx/i })).toHaveAttribute(
      "href",
      "https://example.test/download/agreement.docx",
    );
    expect(screen.getByText("pending.csv").closest("a")).toBeNull();
    expect(screen.getByText("pending.csv").closest("[aria-disabled='true']")).toBeInTheDocument();
  });

  test("falls back to a direct download link when no panel opener is provided", () => {
    render(<GeneratedFilesCard messageId={"messages_1" as Id<"messages">} />);

    expect(screen.getByRole("link", { name: /Agreement.docx/i })).toHaveAttribute(
      "href",
      "https://example.test/download/agreement.docx",
    );
  });

  test("image preview button does not submit an enclosing form", () => {
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <GeneratedFilesCard messageId={"messages_1" as Id<"messages">} />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: /chart.png/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
