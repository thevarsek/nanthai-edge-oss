import { fireEvent, render, screen } from "@testing-library/react";
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

  it("does not render unsafe attachment URLs as clickable or previewable links", () => {
    resolvedUrl = undefined;
    render(
      <MessageAttachments
        messageId={"msg_1" as never}
        isUser={false}
        attachments={[
          {
            type: "file",
            url: "javascript:alert(1)",
            name: "script.pdf",
            mimeType: "application/pdf",
          } as never,
          {
            type: "image",
            url: "data:text/html,<script>alert(1)</script>",
            name: "inline image",
            mimeType: "image/png",
          } as never,
        ]}
      />,
    );

    expect(screen.queryByRole("link", { name: /script.pdf/i })).toBeNull();
    expect(screen.getByText("script.pdf").closest("a")).toBeNull();
    expect(screen.queryByRole("img", { name: "inline image" })).toBeNull();
  });

  it("image preview button does not submit an enclosing form", () => {
    resolvedUrl = undefined;
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
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
        />
      </form>,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
