import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { GeneratedFilesCard, type GeneratedFileForPreview } from "./GeneratedFilesCard";
import type { Id } from "@convex/_generated/dataModel";

const initialGeneratedFiles: GeneratedFileForPreview[] = [
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
];
let generatedFiles = initialGeneratedFiles.map((file) => ({ ...file }));

vi.mock("convex/react", () => ({
  useQuery: () => generatedFiles,
}));

describe("GeneratedFilesCard", () => {
  beforeEach(() => {
    generatedFiles = initialGeneratedFiles.map((file) => ({ ...file }));
  });

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

  test("opens a project-backed presentation in the panel even before a download is available", () => {
    generatedFiles = [{
      _id: "generatedFiles_deck",
      filename: "Launch plan.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      downloadUrl: null,
      presentationProjectId: "presentation_1",
      presentationRevision: 4,
    }];
    const onOpenFile = vi.fn();

    render(<GeneratedFilesCard messageId={"messages_1" as Id<"messages">} onOpenFile={onOpenFile} />);

    fireEvent.click(screen.getByRole("button", { name: /Launch plan.pptx/i }));
    expect(onOpenFile).toHaveBeenCalledWith({
      file: expect.objectContaining({
        presentationProjectId: "presentation_1",
        presentationRevision: 4,
        downloadUrl: null,
      }),
    });
    expect(screen.queryByRole("link", { name: /Download Launch plan.pptx/i })).not.toBeInTheDocument();
  });

  test("routes presentation downloads through the current-canvas side panel", () => {
    generatedFiles = [{
      _id: "generatedFiles_deck",
      filename: "Launch plan.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      downloadUrl: "https://example.test/download/launch-plan.pptx",
      presentationProjectId: "presentation_1",
      presentationRevision: 4,
    }];
    const onOpenFile = vi.fn();

    render(<GeneratedFilesCard messageId={"messages_1" as Id<"messages">} onOpenFile={onOpenFile} />);

    expect(screen.getByRole("button", { name: /Launch plan.pptx/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Download Launch plan.pptx/i })).not.toBeInTheDocument();
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

  test("does not render unsafe generated file download URLs", () => {
    generatedFiles = [
      {
        _id: "generatedFiles_unsafe_doc" as Id<"generatedFiles">,
        filename: "Unsafe.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        downloadUrl: "javascript:alert(1)",
        documentId: "documents_unsafe",
        documentVersionId: "documentVersions_unsafe",
      },
      {
        _id: "generatedFiles_unsafe_image" as Id<"generatedFiles">,
        filename: "Unsafe.png",
        mimeType: "image/png",
        downloadUrl: "data:image/png;base64,AAAA",
      },
    ];

    render(<GeneratedFilesCard messageId={"messages_1" as Id<"messages">} />);

    expect(screen.getByText("Unsafe.docx").closest("a")).toBeNull();
    expect(screen.getByText("Unsafe.docx").closest("[aria-disabled='true']")).toBeInTheDocument();
    expect(screen.queryByAltText("Unsafe.png")).not.toBeInTheDocument();
    expect(screen.getByText("Unsafe.png").closest("a")).toBeNull();
    expect(document.querySelector("[href^='javascript:']")).toBeNull();
    expect(document.querySelector("[href^='data:']")).toBeNull();
  });
});
