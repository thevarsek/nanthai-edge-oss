import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttachmentPreviews } from "./MessageInput.attachments";
import type { AttachmentPreview } from "./MessageInput.attachments.types";

const attachments: AttachmentPreview[] = [
  { name: "first.png", type: "image", mimeType: "image/png" },
  { name: "second.png", type: "image", mimeType: "image/png" },
];

describe("AttachmentPreviews", () => {
  it("closes the role dropdown before removing an attachment", () => {
    const onRemove = vi.fn();
    render(
      <AttachmentPreviews
        attachments={attachments}
        onRemove={onRemove}
        isVideoMode
        onChangeRole={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /Role/i })[1]);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove attachment" })[0]);

    expect(onRemove).toHaveBeenCalledWith(0);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("does not show video role controls without a change handler", () => {
    render(
      <AttachmentPreviews
        attachments={attachments}
        onRemove={vi.fn()}
        isVideoMode
      />,
    );

    expect(screen.queryByRole("button", { name: /Role/i })).not.toBeInTheDocument();
  });
});
