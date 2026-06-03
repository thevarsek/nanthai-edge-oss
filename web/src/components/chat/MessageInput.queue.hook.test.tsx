import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useQueuedFollowUp } from "./MessageInput.queue.hook";
import type { AttachmentPreview } from "./MessageInput.attachments.types";

function Harness({
  chatId = "chat_1",
  text,
  isGenerating = true,
  queuedAttachments = [],
  onSend = vi.fn(),
}: {
  chatId?: string;
  text: string;
  isGenerating?: boolean;
  queuedAttachments?: AttachmentPreview[];
  onSend?: (args: { text: string; attachments?: AttachmentPreview[] }) => boolean | void | Promise<boolean | void>;
}) {
  const queue = useQueuedFollowUp({
    chatId,
    isGenerating,
    isAutonomousActive: false,
    text,
    attachmentCount: 0,
    queuedAttachments,
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

  it("drains queued follow-ups with the displayed extra attachment snapshot", async () => {
    const extraAttachment: AttachmentPreview = {
      storageId: "storage_extra" as never,
      name: "Research notes.pdf",
      type: "document",
      mimeType: "application/pdf",
    };
    const onSend = vi.fn();
    const { rerender } = render(
      <Harness text="use this context" isGenerating queuedAttachments={[extraAttachment]} onSend={onSend} />,
    );

    act(() => {
      screen.getByRole("button", { name: "queue" }).click();
    });

    rerender(<Harness text="" isGenerating={false} queuedAttachments={[]} onSend={onSend} />);

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenLastCalledWith({
      text: "use this context",
      attachments: [extraAttachment],
    });
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

  it("keeps a queued follow-up once when send throws", async () => {
    const onSend = vi.fn(async () => {
      throw new Error("auth unavailable");
    });
    const { rerender } = render(<Harness text="retry later" isGenerating onSend={onSend} />);

    act(() => {
      screen.getByRole("button", { name: "queue" }).click();
    });

    rerender(<Harness text="" isGenerating={false} onSend={onSend} />);

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText("retry later")).toHaveLength(1);
  });

  it("does not drain a queued follow-up after switching away from its chat", async () => {
    const onSend = vi.fn();
    const { rerender } = render(<Harness chatId="chat_1" text="old chat follow-up" isGenerating onSend={onSend} />);

    act(() => {
      screen.getByRole("button", { name: "queue" }).click();
    });

    await act(async () => {
      rerender(<Harness chatId="chat_2" text="" isGenerating={false} onSend={onSend} />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByText("old chat follow-up")).not.toBeInTheDocument();
  });
});
