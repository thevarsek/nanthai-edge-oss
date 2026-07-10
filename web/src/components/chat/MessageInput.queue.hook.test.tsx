import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useQueuedFollowUp } from "./MessageInput.queue.hook";
import type { AttachmentPreview } from "./MessageInput.attachments.types";
import type { QueuedAdvisorSnapshot } from "@/advisors/types";

function Harness({
  chatId = "chat_1",
  text,
  isGenerating = true,
  queuedAttachments = [],
  onSend = vi.fn(),
  onQueueCommitted = vi.fn(),
  canCaptureQueuedAdvisorSnapshot = true,
  captureQueuedAdvisorSnapshot,
  restoreQueuedAdvisorSnapshot,
}: {
  chatId?: string;
  text: string;
  isGenerating?: boolean;
  queuedAttachments?: AttachmentPreview[];
  onSend?: (args: {
    text: string;
    attachments?: AttachmentPreview[];
    advisorSnapshot?: QueuedAdvisorSnapshot;
  }) => boolean | void | Promise<boolean | void>;
  onQueueCommitted?: () => void;
  canCaptureQueuedAdvisorSnapshot?: boolean;
  captureQueuedAdvisorSnapshot?: () => QueuedAdvisorSnapshot | null;
  restoreQueuedAdvisorSnapshot?: (snapshot: QueuedAdvisorSnapshot) => void;
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
    onQueueCommitted,
    onEditCommitted: vi.fn(),
    canCaptureQueuedAdvisorSnapshot,
    captureQueuedAdvisorSnapshot,
    restoreQueuedAdvisorSnapshot,
  });

  return (
    <div>
      <button type="button" onClick={queue.queueFollowUp}>queue</button>
      {queue.queuedFollowUps.map((queued) => (
        <div key={queued.id}>
          <p>{queued.text}</p>
          <button type="button" onClick={() => queue.editQueuedFollowUp(queued.id)}>edit-{queued.text}</button>
          <button type="button" onClick={() => queue.removeQueuedFollowUp(queued.id)}>remove-{queued.text}</button>
        </div>
      ))}
    </div>
  );
}

describe("useQueuedFollowUp", () => {
  it("does not queue or clear the composer when Advisor hydration cannot provide an exact snapshot", () => {
    const onQueueCommitted = vi.fn();
    const captureQueuedAdvisorSnapshot = vi.fn(() => null);
    render(
      <Harness
        text="wait for Advisors"
        onQueueCommitted={onQueueCommitted}
        captureQueuedAdvisorSnapshot={captureQueuedAdvisorSnapshot}
      />,
    );

    act(() => screen.getByRole("button", { name: "queue" }).click());

    expect(captureQueuedAdvisorSnapshot).toHaveBeenCalledTimes(1);
    expect(onQueueCommitted).not.toHaveBeenCalled();
    expect(screen.queryByText("wait for Advisors")).not.toBeInTheDocument();
  });

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

  it("freezes and sends the queued Advisor snapshot", async () => {
    const advisorSnapshot: QueuedAdvisorSnapshot = {
      advisorSelections: [{
        personaId: "persona_1" as never,
        allowWebSearch: true,
        keepAvailable: false,
      }],
      advisorBrief: "Challenge the premise",
    };
    const onSend = vi.fn();
    const captureQueuedAdvisorSnapshot = vi.fn(() => advisorSnapshot);
    const { rerender } = render(
      <Harness
        text="queued with Advisor"
        isGenerating
        onSend={onSend}
        captureQueuedAdvisorSnapshot={captureQueuedAdvisorSnapshot}
      />,
    );

    act(() => screen.getByRole("button", { name: "queue" }).click());
    rerender(
      <Harness
        text=""
        isGenerating={false}
        onSend={onSend}
        captureQueuedAdvisorSnapshot={() => ({ advisorSelections: [] })}
      />,
    );

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(captureQueuedAdvisorSnapshot).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith({
      text: "queued with Advisor",
      attachments: [],
      advisorSnapshot,
    });
  });

  it("keeps an explicit no-Advisor snapshot when the live composer later changes", async () => {
    const capturedSnapshot: QueuedAdvisorSnapshot = { advisorSelections: [] };
    const onSend = vi.fn();
    const { rerender } = render(
      <Harness
        text="queued without Advisor"
        isGenerating
        onSend={onSend}
        captureQueuedAdvisorSnapshot={() => capturedSnapshot}
      />,
    );

    act(() => screen.getByRole("button", { name: "queue" }).click());
    capturedSnapshot.advisorSelections.push({
      personaId: "persona_later" as never,
      allowWebSearch: true,
      keepAvailable: true,
    });
    rerender(
      <Harness
        text=""
        isGenerating={false}
        onSend={onSend}
        captureQueuedAdvisorSnapshot={() => capturedSnapshot}
      />,
    );

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith({
      text: "queued without Advisor",
      attachments: [],
      advisorSnapshot: { advisorSelections: [] },
    });
  });

  it("restores a queued Advisor snapshot when the message is edited or removed", () => {
    const advisorSnapshot: QueuedAdvisorSnapshot = {
      advisorSelections: [{
        personaId: "persona_1" as never,
        allowWebSearch: false,
        keepAvailable: false,
      }],
    };
    const restoreQueuedAdvisorSnapshot = vi.fn();
    const { rerender } = render(
      <Harness
        text="edit me"
        captureQueuedAdvisorSnapshot={() => advisorSnapshot}
        restoreQueuedAdvisorSnapshot={restoreQueuedAdvisorSnapshot}
      />,
    );
    act(() => screen.getByRole("button", { name: "queue" }).click());
    act(() => screen.getByRole("button", { name: "edit-edit me" }).click());
    expect(restoreQueuedAdvisorSnapshot).toHaveBeenLastCalledWith(advisorSnapshot);

    rerender(
      <Harness
        text="remove me"
        captureQueuedAdvisorSnapshot={() => advisorSnapshot}
        restoreQueuedAdvisorSnapshot={restoreQueuedAdvisorSnapshot}
      />,
    );
    act(() => screen.getByRole("button", { name: "queue" }).click());
    act(() => screen.getByRole("button", { name: "remove-remove me" }).click());
    expect(restoreQueuedAdvisorSnapshot).toHaveBeenCalledTimes(2);
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
