import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DocumentPreviewContent, type DocumentPreviewPayload } from "./DocumentPreviewContent";

describe("DocumentPreviewContent", () => {
  let originalScrollIntoView: typeof HTMLElement.prototype.scrollIntoView | undefined;
  let scrolledElements: Element[];

  beforeEach(() => {
    vi.useFakeTimers();
    scrolledElements = [];
    originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: function scrollIntoView(this: Element) {
        scrolledElements.push(this);
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView,
      });
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    }
  });

  test("focuses typed tracked-change paragraphs ahead of duplicate normal text", () => {
    render(
      <DocumentPreviewContent
        preview={previewWithDuplicateNormalText()}
        focusedAnnotation={{
          deletedText: "seller",
          insertedText: "buyer",
        } as NonNullable<Parameters<typeof DocumentPreviewContent>[0]["focusedAnnotation"]>}
      />,
    );

    vi.runOnlyPendingTimers();

    const paragraphs = screen.getAllByText(/seller|buyer/i).map((node) => node.closest("p"));
    const unchangedParagraph = screen.getByText("Pay seller and buyer promptly.").closest("p");
    const trackedParagraph = paragraphs.find((paragraph) => paragraph !== unchangedParagraph);

    expect(unchangedParagraph?.className).not.toContain("bg-amber-100");
    expect(trackedParagraph?.className).toContain("bg-amber-100");
    expect(scrolledElements).toEqual([trackedParagraph]);
  });

  test("requires both sides of a focused edit to match the same tracked-change paragraph", () => {
    render(
      <DocumentPreviewContent
        preview={previewWithSharedInsertedTrackedText()}
        focusedAnnotation={{
          deletedText: "seller",
          insertedText: "buyer",
        } as NonNullable<Parameters<typeof DocumentPreviewContent>[0]["focusedAnnotation"]>}
      />,
    );

    vi.runOnlyPendingTimers();

    const sellerParagraph = screen.getByText("seller").closest("p");
    const vendorParagraph = screen.getByText("vendor").closest("p");

    expect(sellerParagraph?.className).toContain("bg-amber-100");
    expect(vendorParagraph?.className).not.toContain("bg-amber-100");
    expect(scrolledElements).toEqual([sellerParagraph]);
  });
});

function previewWithDuplicateNormalText(): DocumentPreviewPayload {
  return {
    kind: "docx",
    versionId: "version_1",
    filename: "Agreement.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    paragraphs: [
      {
        style: "Normal",
        segments: [{ kind: "normal", text: "Pay seller and buyer promptly." }],
      },
      {
        style: "Normal",
        segments: [
          { kind: "normal", text: "Pay " },
          { kind: "deleted", text: "seller" },
          { kind: "inserted", text: "buyer" },
          { kind: "normal", text: " promptly." },
        ],
      },
    ],
    wordCount: 8,
  };
}

function previewWithSharedInsertedTrackedText(): DocumentPreviewPayload {
  return {
    kind: "docx",
    versionId: "version_2",
    filename: "Agreement.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    paragraphs: [
      {
        style: "Normal",
        segments: [
          { kind: "normal", text: "Pay " },
          { kind: "deleted", text: "seller" },
          { kind: "inserted", text: "buyer" },
          { kind: "normal", text: " promptly." },
        ],
      },
      {
        style: "Normal",
        segments: [
          { kind: "normal", text: "Notify " },
          { kind: "deleted", text: "vendor" },
          { kind: "inserted", text: "buyer" },
          { kind: "normal", text: " promptly." },
        ],
      },
    ],
    wordCount: 10,
  };
}
