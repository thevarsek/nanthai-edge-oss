import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { MessageInput, type AttachmentPreview } from "./MessageInput";

const generatedDocument: AttachmentPreview = {
  storageId: "storage_1" as Id<"_storage">,
  name: "Research notes.pdf",
  type: "document",
  mimeType: "application/pdf",
};

function renderMessageInput({
  chatId = "chat_1" as Id<"chats">,
  onSend = vi.fn(),
  extraAttachments = [],
}: {
  chatId?: Id<"chats">;
  onSend?: (args: { text: string; attachments?: AttachmentPreview[] }) => boolean | void | Promise<boolean | void>;
  extraAttachments?: AttachmentPreview[];
} = {}) {
  return render(
    <MessageInput
      chatId={chatId}
      participants={[]}
      isGenerating={false}
      onSend={onSend}
      onCancel={vi.fn()}
      onCreateUploadUrl={vi.fn()}
      generatedDocumentSuggestion={generatedDocument}
      extraAttachments={extraAttachments}
    />,
  );
}

describe("MessageInput", () => {
  it("keeps draft text and staged attachments when send validation fails", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(false);
    renderMessageInput({ chatId: "chat_blocked" as Id<"chats">, onSend });

    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.type(screen.getByRole("textbox"), "blocked send");
    await user.click(screen.getByTitle("Send (Enter)"));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith({
      text: "blocked send",
      attachments: [expect.objectContaining({ name: "Research notes.pdf" })],
    });
    expect(screen.getByRole("textbox")).toHaveValue("blocked send");
    expect(screen.getByText("Research notes.pdf")).toBeInTheDocument();
  });

  it("clears draft text and staged attachments when send succeeds", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderMessageInput({ chatId: "chat_valid" as Id<"chats">, onSend });

    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.type(screen.getByRole("textbox"), "valid send");
    await user.click(screen.getByTitle("Send (Enter)"));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.queryByText("Research notes.pdf")).not.toBeInTheDocument();
  });

  it("sends displayed extra attachments with the message payload", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderMessageInput({
      chatId: "chat_extra" as Id<"chats">,
      onSend,
      extraAttachments: [generatedDocument],
    });

    await user.type(screen.getByRole("textbox"), "include context");
    await user.click(screen.getByTitle("Send (Enter)"));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith({
      text: "include context",
      attachments: [expect.objectContaining({ storageId: "storage_1" })],
    });
  });

  it("enables send when an extra attachment is the only content", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderMessageInput({
      chatId: "chat_extra_only" as Id<"chats">,
      onSend,
      extraAttachments: [generatedDocument],
    });

    await user.click(screen.getByTitle("Send (Enter)"));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith({
      text: "",
      attachments: [expect.objectContaining({ storageId: "storage_1" })],
    });
  });
});
