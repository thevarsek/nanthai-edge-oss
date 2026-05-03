import { render, screen } from "@testing-library/react";
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
    },
    {
      _id: "generatedFiles_png" as Id<"generatedFiles">,
      filename: "chart.png",
      mimeType: "image/png",
      sizeBytes: 42_000,
      downloadUrl: "https://example.test/download/chart.png",
    },
  ],
}));

describe("GeneratedFilesCard", () => {
  test("renders generated document and image affordances from seeded Convex data", () => {
    render(<GeneratedFilesCard messageId={"messages_1" as Id<"messages">} />);

    expect(screen.getByText("Agreement.docx")).toBeInTheDocument();
    expect(screen.getByText(/Saved document/)).toBeInTheDocument();
    expect(screen.getByAltText("chart.png")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Agreement.docx/i })).toHaveAttribute(
      "href",
      "https://example.test/download/agreement.docx",
    );
  });
});
