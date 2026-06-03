import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { DocumentPreviewPanel, type DocumentPreviewSelection } from "./DocumentPreviewPanel";

const convexMocks = vi.hoisted(() => ({
  generatedFiles: [{
    _id: "generatedFiles_1",
    filename: "Agreement.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 12_600,
    downloadUrl: "https://example.test/agreement.docx",
    documentVersionId: "version_2",
  }] as Array<{
    _id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    downloadUrl: string;
    documentVersionId: string;
  }> | undefined,
  getDocumentPreview: vi.fn(async () => ({
    kind: "docx",
    versionId: "version_2",
    filename: "Agreement.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    paragraphs: [{
      style: "Normal",
      segments: [
        { kind: "normal", text: "This agreement has an " },
        { kind: "deleted", text: "old clause" },
        { kind: "inserted", text: "new clause" },
        { kind: "normal", text: "." },
      ],
    }],
    wordCount: 8,
  })),
}));

vi.mock("convex/react", () => ({
  useAction: () => convexMocks.getDocumentPreview,
  useQuery: () => convexMocks.generatedFiles,
}));

describe("DocumentPreviewPanel", () => {
  beforeEach(() => {
    convexMocks.getDocumentPreview.mockClear();
    convexMocks.generatedFiles = [generatedFile()];
  });

  test("renders generated DOCX metadata, document preview, and tracked-change details", async () => {
    render(
      <DocumentPreviewPanel
        selection={selection()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Agreement.docx")).toBeInTheDocument();
    expect(screen.getByText(/Word document.*12\.3 KB/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download Agreement.docx/i })).toHaveAttribute(
      "href",
      "https://example.test/agreement.docx",
    );
    await waitFor(() => {
      expect(screen.getByText(/This agreement has an/)).toBeInTheDocument();
    });
    expect(screen.getByText("Tracked changes")).toBeInTheDocument();
    expect(screen.getAllByText("old clause").length).toBeGreaterThan(0);
    expect(screen.getAllByText("new clause").length).toBeGreaterThan(0);
  });

  test("prefers live generated-file version over stale selection version", async () => {
    render(
      <DocumentPreviewPanel
        selection={{ ...selection(), versionId: "stale_version" as Id<"documentVersions"> }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(convexMocks.getDocumentPreview).toHaveBeenCalledWith({ versionId: "version_2" });
    });
  });

  test("waits for live generated-file metadata before fetching preview", async () => {
    convexMocks.generatedFiles = undefined;
    const staleSelection = { ...selection(), versionId: "stale_version" as Id<"documentVersions"> };

    const { rerender } = render(
      <DocumentPreviewPanel
        selection={staleSelection}
        onClose={vi.fn()}
      />,
    );

    expect(convexMocks.getDocumentPreview).not.toHaveBeenCalled();

    convexMocks.generatedFiles = [generatedFile({ documentVersionId: "live_version" })];
    rerender(
      <DocumentPreviewPanel
        selection={staleSelection}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(convexMocks.getDocumentPreview).toHaveBeenCalledWith({ versionId: "live_version" });
    });
    expect(convexMocks.getDocumentPreview).not.toHaveBeenCalledWith({ versionId: "stale_version" });
  });

  test("renders PDFs from the download URL without fetching paragraph preview", () => {
    render(
      <DocumentPreviewPanel
        selection={{
          filename: "Contract.pdf",
          mimeType: "application/pdf",
          downloadUrl: "https://example.test/contract.pdf",
          annotations: [],
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTitle("Contract.pdf")).toHaveAttribute("src", "https://example.test/contract.pdf");
    expect(convexMocks.getDocumentPreview).not.toHaveBeenCalled();
  });
});

function selection(): DocumentPreviewSelection {
  return {
    messageId: "messages_1" as Id<"messages">,
    generatedFileId: "generatedFiles_1" as Id<"generatedFiles">,
    filename: "Agreement.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    annotations: [{
      type: "docx_edit_proposed",
      editId: "edit_1" as Id<"documentEdits">,
      editBatchId: "batch_1" as Id<"documentEditBatches">,
      generationKey: "generation_1",
      documentId: "doc_1" as Id<"documents">,
      versionId: "version_2" as Id<"documentVersions">,
      baseVersionId: "version_1" as Id<"documentVersions">,
      introducedVersionId: "version_2" as Id<"documentVersions">,
      filename: "Agreement.docx",
      versionNumber: 2,
      changeId: "change_1",
      deletedText: "old clause",
      insertedText: "new clause",
      status: "pending",
      displayStatus: "pending",
      canUndo: false,
    }],
  };
}

function generatedFile(overrides: Partial<NonNullable<typeof convexMocks.generatedFiles>[number]> = {}) {
  return {
    _id: "generatedFiles_1",
    filename: "Agreement.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 12_600,
    downloadUrl: "https://example.test/agreement.docx",
    documentVersionId: "version_2",
    ...overrides,
  };
}
