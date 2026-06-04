import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { MessageInput, type AttachmentPreview } from "./MessageInput";
import { clearChatDraft, getChatDraft, setChatDraft } from "@/stores/chatDraftStore";

const generatedDocument: AttachmentPreview = {
  storageId: "storage_1" as Id<"_storage">,
  name: "Research notes.pdf",
  type: "document",
  mimeType: "application/pdf",
};

function renderMessageInput({
  chatId = "chat_1" as Id<"chats">,
  onSend = vi.fn(),
  onCreateUploadUrl = vi.fn(),
  extraAttachments = [],
}: {
  chatId?: Id<"chats">;
  onSend?: (args: { text: string; attachments?: AttachmentPreview[] }) => boolean | void | Promise<boolean | void>;
  onCreateUploadUrl?: () => Promise<string>;
  extraAttachments?: AttachmentPreview[];
} = {}) {
  return render(
    <MessageInput
      chatId={chatId}
      participants={[]}
      isGenerating={false}
      onSend={onSend}
      onCancel={vi.fn()}
      onCreateUploadUrl={onCreateUploadUrl}
      generatedDocumentSuggestion={generatedDocument}
      extraAttachments={extraAttachments}
    />,
  );
}

describe("MessageInput", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearChatDraft("chat_1");
    clearChatDraft("chat_blocked");
    clearChatDraft("chat_valid");
    clearChatDraft("chat_rejected");
    clearChatDraft("chat_upload_failed");
    clearChatDraft("chat_upload_success");
    clearChatDraft("chat_upload_image_camera");
    clearChatDraft("chat_upload_partial");
    clearChatDraft("chat_restore_a");
    clearChatDraft("chat_restore_b");
    clearChatDraft("chat_switch_a");
    clearChatDraft("chat_switch_b");
    clearChatDraft("chat_extra");
    clearChatDraft("chat_extra_only");
  });

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

  it("keeps draft text and staged attachments when send rejects", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockRejectedValue(new Error("OpenRouter unavailable"));
    renderMessageInput({ chatId: "chat_rejected" as Id<"chats">, onSend });

    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.type(screen.getByRole("textbox"), "preserve this");
    await user.click(screen.getByTitle("Send (Enter)"));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("textbox")).toHaveValue("preserve this");
    expect(screen.getByText("Research notes.pdf")).toBeInTheDocument();
  });

  it("keeps existing draft and attachments when upload fails", async () => {
    const user = userEvent.setup();
    const onCreateUploadUrl = vi.fn(async () => "https://uploads.example/file");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    const { container } = renderMessageInput({
      chatId: "chat_upload_failed" as Id<"chats">,
      onCreateUploadUrl,
    });

    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.type(screen.getByRole("textbox"), "upload can fail");
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, new File(["bad"], "broken.pdf", { type: "application/pdf" }));

    await waitFor(() => expect(screen.getByText("1 file failed to upload.")).toBeInTheDocument());
    expect(screen.getByRole("textbox")).toHaveValue("upload can fail");
    expect(screen.getByText("Research notes.pdf")).toBeInTheDocument();
  });

  it("stages successful uploaded files and sends their storage metadata", async () => {
    const user = userEvent.setup();
    const file = new File(["ok"], "notes.pdf", { type: "application/pdf" });
    const onCreateUploadUrl = vi.fn(async () => "https://uploads.example/ok");
    const fetch = vi.fn(async () => new Response(JSON.stringify({ storageId: "storage_uploaded" }), { status: 200 }));
    const onSend = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetch);

    const { container } = renderMessageInput({
      chatId: "chat_upload_success" as Id<"chats">,
      onCreateUploadUrl,
      onSend,
    });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await waitFor(() => expect(screen.getByText("notes.pdf")).toBeInTheDocument());

    expect(onCreateUploadUrl).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("https://uploads.example/ok", {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    });
    expect(fileInput.value).toBe("");

    await user.type(screen.getByRole("textbox"), "send upload");
    await user.click(screen.getByTitle("Send (Enter)"));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith({
      text: "send upload",
      attachments: [expect.objectContaining({
        storageId: "storage_uploaded",
        name: "notes.pdf",
        type: "document",
        mimeType: "application/pdf",
        sizeBytes: file.size,
      })],
    }));
  });

  it("resets image and camera file inputs after successful upload", async () => {
    const user = userEvent.setup();
    const imageFile = new File(["image"], "frame.png", { type: "image/png" });
    const cameraFile = new File(["camera"], "capture.png", { type: "image/png" });
    const onCreateUploadUrl = vi
      .fn()
      .mockResolvedValueOnce("https://uploads.example/image")
      .mockResolvedValueOnce("https://uploads.example/camera");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ storageId: "storage_image" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ storageId: "storage_camera" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    const { container } = renderMessageInput({
      chatId: "chat_upload_image_camera" as Id<"chats">,
      onCreateUploadUrl,
    });
    const [imageInput, cameraInput] = Array.from(
      container.querySelectorAll('input[accept="image/*"]'),
    ) as HTMLInputElement[];

    await user.upload(imageInput, imageFile);
    await waitFor(() => expect(screen.getByText("frame.png")).toBeInTheDocument());
    expect(imageInput.value).toBe("");

    await user.upload(cameraInput, cameraFile);
    await waitFor(() => expect(screen.getByText("capture.png")).toBeInTheDocument());
    expect(cameraInput.value).toBe("");
  });

  it("keeps successful uploads when another selected file fails", async () => {
    const user = userEvent.setup();
    const goodFile = new File(["ok"], "good.pdf", { type: "application/pdf" });
    const badFile = new File(["bad"], "bad.pdf", { type: "application/pdf" });
    const onCreateUploadUrl = vi
      .fn()
      .mockResolvedValueOnce("https://uploads.example/good")
      .mockResolvedValueOnce("https://uploads.example/bad");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ storageId: "storage_good" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetch);

    const { container } = renderMessageInput({
      chatId: "chat_upload_partial" as Id<"chats">,
      onCreateUploadUrl,
    });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, [goodFile, badFile]);

    await waitFor(() => expect(screen.getByText("good.pdf")).toBeInTheDocument());
    expect(screen.getByText("1 file failed to upload.")).toBeInTheDocument();
    expect(screen.queryByText("bad.pdf")).not.toBeInTheDocument();
    expect(screen.queryByText("uploading")).not.toBeInTheDocument();
  });

  it("restores draft text and staged attachments when switching back to a chat", async () => {
    const user = userEvent.setup();
    const { rerender } = renderMessageInput({
      chatId: "chat_restore_a" as Id<"chats">,
    });

    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.type(screen.getByRole("textbox"), "restore me");

    rerender(
      <MessageInput
        chatId={"chat_restore_b" as Id<"chats">}
        participants={[]}
        isGenerating={false}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onCreateUploadUrl={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.queryByText("Research notes.pdf")).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox"), "other chat");

    rerender(
      <MessageInput
        chatId={"chat_restore_a" as Id<"chats">}
        participants={[]}
        isGenerating={false}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onCreateUploadUrl={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox")).toHaveValue("restore me");
    expect(screen.getByText("Research notes.pdf")).toBeInTheDocument();
  });

  it("does not overwrite the destination chat draft while hydrating a chat switch", async () => {
    setChatDraft("chat_switch_a", { text: "alpha draft", attachments: [] });
    setChatDraft("chat_switch_b", {
      text: "bravo draft",
      attachments: [generatedDocument],
    });

    const { rerender } = renderMessageInput({
      chatId: "chat_switch_a" as Id<"chats">,
    });
    expect(screen.getByRole("textbox")).toHaveValue("alpha draft");

    rerender(
      <MessageInput
        chatId={"chat_switch_b" as Id<"chats">}
        participants={[]}
        isGenerating={false}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onCreateUploadUrl={vi.fn()}
        generatedDocumentSuggestion={generatedDocument}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue("bravo draft");
    });
    expect(getChatDraft("chat_switch_b")).toEqual({
      text: "bravo draft",
      attachments: [generatedDocument],
    });
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
