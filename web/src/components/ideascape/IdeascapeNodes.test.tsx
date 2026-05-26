import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageNode } from "./IdeascapeNodes";

vi.mock("@/components/chat/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

describe("MessageNode", () => {
  it("focuses the message when clicking body content", () => {
    const onFocus = vi.fn();

    render(
      <MessageNode
        message={{
          _id: "message_1",
          role: "assistant",
          content: "Body text",
          status: "complete",
        } as never}
        x={0}
        y={0}
        width={220}
        height={160}
        visualState="default"
        onPointerDown={vi.fn()}
        onResizePointerDown={vi.fn()}
        onSelect={vi.fn()}
        onFocus={onFocus}
      />,
    );

    fireEvent.click(screen.getByText("Body text"));

    expect(onFocus).toHaveBeenCalledWith("message_1");
  });
});
