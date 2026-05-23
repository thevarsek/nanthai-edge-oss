import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageAttachments } from "./MessageAttachments";

let resolvedUrl: string | undefined;

vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) => (args === "skip" ? undefined : resolvedUrl),
}));

describe("MessageAttachments", () => {
  it("renders URL-only image attachments without Convex storage resolution", () => {
    resolvedUrl = undefined;
    render(
      <MessageAttachments
        messageId={"msg_1" as never}
        isUser={false}
        attachments={[
          {
            type: "image",
            url: "https://tracker.example/image.png",
            name: "external image",
            mimeType: "image/png",
          } as never,
        ]}
      />,
    );

    expect(screen.getByRole("img", { name: "external image" })).toHaveAttribute(
      "src",
      "https://tracker.example/image.png",
    );
  });

  it("renders storage-backed attachments with the Convex-resolved URL", () => {
    resolvedUrl = "https://convex.example/attachment.png";
    render(
      <MessageAttachments
        messageId={"msg_1" as never}
        isUser={false}
        attachments={[
          {
            type: "image",
            storageId: "storage_1",
            name: "stored image",
            mimeType: "image/png",
          } as never,
        ]}
      />,
    );

    expect(screen.getByRole("img", { name: "stored image" })).toHaveAttribute(
      "src",
      "https://convex.example/attachment.png",
    );
  });

  it("links URL-only file attachments", () => {
    resolvedUrl = undefined;
    render(
      <MessageAttachments
        messageId={"msg_1" as never}
        isUser={false}
        attachments={[
          {
            type: "file",
            url: "https://files.example/report.pdf",
            name: "report.pdf",
            mimeType: "application/pdf",
          } as never,
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: /report.pdf/i })).toHaveAttribute(
      "href",
      "https://files.example/report.pdf",
    );
  });
});
