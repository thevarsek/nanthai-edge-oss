import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { clearChatDraft } from "@/stores/chatDraftStore";
import { MessageInput } from "./MessageInput";

function renderInput({
  chatId = "chat_behavior" as Id<"chats">,
  isGenerating = false,
  isAutonomousActive = false,
  isVideoMode = false,
  supportsFrameImages = true,
  disabled = false,
  onSend = vi.fn(),
  onCancel = vi.fn(),
  onIntervene,
  onPlusMenuSelect,
}: Partial<Parameters<typeof MessageInput>[0]> = {}) {
  return render(
    <MessageInput
      chatId={chatId}
      participants={[]}
      isGenerating={isGenerating}
      isAutonomousActive={isAutonomousActive}
      isVideoMode={isVideoMode}
      supportsFrameImages={supportsFrameImages}
      disabled={disabled}
      onSend={onSend}
      onCancel={onCancel}
      onIntervene={onIntervene}
      onPlusMenuSelect={onPlusMenuSelect}
      onCreateUploadUrl={vi.fn(async () => "https://uploads.example/file")}
      isPro
      hasConnectedIntegrations
      participantCount={1}
    />,
  );
}

describe("MessageInput behavior branches", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearChatDraft("chat_behavior");
    clearChatDraft("chat_generating");
    clearChatDraft("chat_disabled");
    clearChatDraft("chat_video");
  });

  it("routes the stop button to cancellation while generation is active", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderInput({ chatId: "chat_generating" as Id<"chats">, isGenerating: true, onCancel });

    await user.click(screen.getByTitle("Stop generation"));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("sends autonomous intervention text without calling normal send", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onIntervene = vi.fn();
    renderInput({ isAutonomousActive: true, onIntervene, onSend });

    await user.type(screen.getByRole("textbox"), "step in");
    await user.click(screen.getByTitle("Send (Enter)"));

    expect(onIntervene).toHaveBeenCalledWith("step in");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("keeps disabled composer actions inert", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderInput({ chatId: "chat_disabled" as Id<"chats">, disabled: true, onSend });

    expect(screen.getByRole("textbox")).toBeDisabled();
    await user.click(screen.getByTitle("More options"));
    await user.click(screen.getByTitle("Send (Enter)"));

    expect(onSend).not.toHaveBeenCalled();
  });

  it("passes product panels through the plus menu callback and closes the menu", async () => {
    const user = userEvent.setup();
    const onPlusMenuSelect = vi.fn();
    renderInput({ onPlusMenuSelect });

    await user.click(screen.getByTitle("More options"));
    await user.click(screen.getByRole("button", { name: /chat parameters/i }));

    expect(onPlusMenuSelect).toHaveBeenCalledWith("parameters");
    await waitFor(() => expect(screen.queryByRole("button", { name: /chat parameters/i })).not.toBeInTheDocument());
  });

  it("renders the no-frame video hint separately from frame-capable video mode", () => {
    const { rerender } = renderInput({
      chatId: "chat_video" as Id<"chats">,
      isVideoMode: true,
      supportsFrameImages: false,
    });

    expect(screen.getByText(/text-to-video only/i)).toBeInTheDocument();

    rerender(
      <MessageInput
        chatId={"chat_video" as Id<"chats">}
        participants={[]}
        isGenerating={false}
        isVideoMode
        supportsFrameImages
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onCreateUploadUrl={vi.fn(async () => "https://uploads.example/file")}
      />,
    );

    expect(screen.getByText(/attached images only/i)).toBeInTheDocument();
  });
});
