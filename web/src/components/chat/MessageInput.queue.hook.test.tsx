import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useQueuedFollowUp } from "./MessageInput.queue.hook";

function Harness({
  text,
  isGenerating = true,
  onSend = vi.fn(),
}: {
  text: string;
  isGenerating?: boolean;
  onSend?: (args: { text: string; attachments?: unknown[] }) => boolean | void | Promise<boolean | void>;
}) {
  const queue = useQueuedFollowUp({
    chatId: "chat_1",
    isGenerating,
    isAutonomousActive: false,
    text,
    attachmentCount: 0,
    isUploading: false,
    disabled: false,
    onSend,
    onCancel: vi.fn(),
    onQueueCommitted: vi.fn(),
    onEditCommitted: vi.fn(),
  });

  return (
    <div>
      <button type="button" onClick={queue.queueFollowUp}>queue</button>
      {queue.queuedFollowUps.map((queued) => (
        <p key={queued.id}>{queued.text}</p>
      ))}
    </div>
  );
}

describe("useQueuedFollowUp", () => {
  it("appends multiple queued follow-ups for the same chat", () => {
    const { rerender } = render(<Harness text=" first " />);

    act(() => {
      screen.getByRole("button", { name: "queue" }).click();
    });
    rerender(<Harness text="second" />);
    act(() => {
      screen.getByRole("button", { name: "queue" }).click();
    });

    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("drains one queued follow-up per completed generation cycle", async () => {
    const onSend = vi.fn();
    const { rerender } = render(<Harness text="first" isGenerating onSend={onSend} />);

    act(() => {
      screen.getByRole("button", { name: "queue" }).click();
    });
    rerender(<Harness text="second" isGenerating onSend={onSend} />);
    act(() => {
      screen.getByRole("button", { name: "queue" }).click();
    });

    rerender(<Harness text="" isGenerating={false} onSend={onSend} />);
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenLastCalledWith({ text: "first", attachments: [] });

    rerender(<Harness text="" isGenerating={false} onSend={onSend} />);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(onSend).toHaveBeenCalledTimes(1);

    rerender(<Harness text="" isGenerating onSend={onSend} />);
    rerender(<Harness text="" isGenerating={false} onSend={onSend} />);
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect(onSend).toHaveBeenLastCalledWith({ text: "second", attachments: [] });
  });

  it("keeps queued follow-up when validation prevents send", async () => {
    const onSend = vi.fn(() => false);
    const { rerender } = render(<Harness text="blocked" isGenerating onSend={onSend} />);

    act(() => {
      screen.getByRole("button", { name: "queue" }).click();
    });

    rerender(<Harness text="" isGenerating={false} onSend={onSend} />);

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(screen.getByText("blocked")).toBeInTheDocument();
  });
});
