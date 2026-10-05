import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { MessageInput } from "./MessageInput";
import { clearChatDraft } from "@/stores/chatDraftStore";

const chatId = "chat_upload_lifecycle" as Id<"chats">;

function inputProps(args: {
  onSend: ReturnType<typeof vi.fn>;
  onCleanupUploadSession: ReturnType<typeof vi.fn>;
  onCreateUploadUrl: ReturnType<typeof vi.fn>;
  onBindUploadSession: ReturnType<typeof vi.fn>;
}) {
  return {
    chatId,
    participants: [],
    isGenerating: false,
    onCancel: vi.fn(),
    ...args,
  };
}

describe("MessageInput upload lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearChatDraft(chatId);
  });

  it("retains a rejected send across a parent rerender and cleans it after retry succeeds", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn()
      .mockRejectedValueOnce(new Error("send failed"))
      .mockResolvedValueOnce(undefined);
    const firstCleanup = vi.fn(async () => {});
    const latestCleanup = vi.fn(async () => {});
    const onCreateUploadUrl = vi.fn(async () => ({
      uploadUrl: "https://uploads.example/retry",
      uploadSessionId: "session_retry",
    }));
    const onBindUploadSession = vi.fn(async () => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ storageId: "storage_retry" }),
      { status: 200 },
    )));

    const view = render(<MessageInput {...inputProps({
      onSend,
      onCleanupUploadSession: firstCleanup,
      onCreateUploadUrl,
      onBindUploadSession,
    })} />);
    const fileInput = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, new File(["retry"], "retry.txt", { type: "text/plain" }));
    await user.type(screen.getByRole("textbox"), "retry this send");
    await user.click(screen.getByTitle("Send (Enter)"));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(screen.getByText("retry.txt")).toBeInTheDocument();

    view.rerender(<MessageInput {...inputProps({
      onSend,
      onCleanupUploadSession: latestCleanup,
      onCreateUploadUrl,
      onBindUploadSession,
    })} />);

    expect(firstCleanup).not.toHaveBeenCalled();
    expect(latestCleanup).not.toHaveBeenCalled();
    expect(screen.getByText("retry.txt")).toBeInTheDocument();

    await user.click(screen.getByTitle("Send (Enter)"));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect(onSend).toHaveBeenLastCalledWith({
      text: "retry this send",
      attachments: [expect.objectContaining({
        storageId: "storage_retry",
        uploadSessionId: "session_retry",
      })],
    });
    await waitFor(() => expect(latestCleanup).toHaveBeenCalledWith(
      "session_retry",
      "storage_retry",
    ));
    expect(screen.queryByText("retry.txt")).not.toBeInTheDocument();
  });

  it("cleans a retained upload on unmount using the latest callback", async () => {
    const user = userEvent.setup();
    const firstCleanup = vi.fn(async () => {});
    const latestCleanup = vi.fn(async () => {});
    const onCreateUploadUrl = vi.fn(async () => ({
      uploadUrl: "https://uploads.example/unmount",
      uploadSessionId: "session_unmount",
    }));
    const onBindUploadSession = vi.fn(async () => {});
    const onSend = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ storageId: "storage_unmount" }),
      { status: 200 },
    )));

    const view = render(<MessageInput {...inputProps({
      onSend,
      onCleanupUploadSession: firstCleanup,
      onCreateUploadUrl,
      onBindUploadSession,
    })} />);
    const fileInput = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, new File(["unmount"], "unmount.txt", { type: "text/plain" }));
    await waitFor(() => expect(screen.getByText("unmount.txt")).toBeInTheDocument());

    view.rerender(<MessageInput {...inputProps({
      onSend,
      onCleanupUploadSession: latestCleanup,
      onCreateUploadUrl,
      onBindUploadSession,
    })} />);
    expect(firstCleanup).not.toHaveBeenCalled();

    view.unmount();

    await waitFor(() => expect(latestCleanup).toHaveBeenCalledWith(
      "session_unmount",
      "storage_unmount",
    ));
    expect(firstCleanup).not.toHaveBeenCalled();
  });
});
