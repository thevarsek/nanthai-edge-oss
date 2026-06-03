import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";
import { AudioPlaybackContext, type AudioPlaybackContextValue } from "./AudioPlaybackContext.hook";
import { AssistantMessage } from "./MessageBubble.AssistantMessage";

vi.mock("./VideoGenerationProgress", () => ({
  VideoGenerationProgress: () => <div data-testid="video-progress" />,
}));

vi.mock("./ToolCallAccordion", () => ({
  ToolCallAccordion: () => <div data-testid="tool-accordion" />,
}));

vi.mock("./SubagentBatchPanel", () => ({
  SubagentBatchPanel: ({ batchId }: { batchId: string }) => <div data-testid="subagent-batch">{batchId}</div>,
}));

vi.mock("./GeneratedFilesCard", () => ({
  GeneratedFilesCard: ({ messageId }: { messageId: string }) => <div data-testid="generated-files">{messageId}</div>,
}));

vi.mock("./GeneratedChartsCard", () => ({
  GeneratedChartsCard: ({ messageId }: { messageId: string }) => <div data-testid="generated-charts">{messageId}</div>,
}));

vi.mock("./MessageAttachments", () => ({
  MessageAttachments: ({ attachments }: { attachments: unknown[] }) => <div data-testid="attachments">{attachments.length}</div>,
}));

vi.mock("./AudioMessageBubble", () => ({
  AudioMessageBubble: ({ onPlay }: { onPlay: () => void }) => (
    <button type="button" onClick={onPlay}>audio-player</button>
  ),
}));

vi.mock("@/components/shared/PersonaAvatar", () => ({
  PersonaAvatar: ({ personaName, personaEmoji }: { personaName?: string; personaEmoji?: string }) => (
    <div data-testid="persona-avatar">{personaEmoji ?? personaName}</div>
  ),
}));

vi.mock("@/hooks/useSharedData", () => ({
  useModelSummaries: () => [],
}));

const convexMocks = vi.hoisted(() => ({
  resolveDocumentEdit: vi.fn(async () => ({ ok: true })),
  undoDocumentEditResolution: vi.fn(async () => ({ ok: true })),
}));

vi.mock("convex/react", () => ({
  useAction: () => convexMocks.resolveDocumentEdit,
  useMutation: () => convexMocks.undoDocumentEditResolution,
}));

function message(overrides: Partial<Message> = {}): Message {
  return {
    _id: "message_1" as Id<"messages">,
    _creationTime: 1,
    chatId: "chat_1" as Id<"chats">,
    role: "assistant",
    content: "Hello",
    status: "completed",
    createdAt: 1,
    ...overrides,
  };
}

function pendingDocumentEdit(): NonNullable<Message["documentEditAnnotations"]>[number] {
  return {
    type: "docx_edit_proposed",
    editId: "edit_pending" as Id<"documentEdits">,
    editBatchId: "batch_1" as Id<"documentEditBatches">,
    generationKey: "generation_1",
    documentId: "doc_1" as Id<"documents">,
    versionId: "version_2" as Id<"documentVersions">,
    baseVersionId: "version_1" as Id<"documentVersions">,
    introducedVersionId: "version_2" as Id<"documentVersions">,
    filename: "contract.docx",
    versionNumber: 2,
    changeId: "change_pending",
    deletedText: "old clause",
    insertedText: "new clause",
    status: "pending",
    displayStatus: "pending",
    canUndo: false,
  };
}

function renderAssistant(
  messageOverride: Partial<Message>,
  options: { participants?: ComponentProps<typeof AssistantMessage>["participants"] } = {},
) {
  const audio: AudioPlaybackContextValue = {
    state: {
      activeMessageId: null,
      isPlaying: false,
      isLoading: false,
      progress: 0,
      duration: 0,
      currentTime: 0,
      speed: 1,
    },
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    stop: vi.fn(),
    cycleSpeed: vi.fn(),
    seek: vi.fn(),
  };

  return render(
    <AudioPlaybackContext.Provider value={audio}>
      <AssistantMessage
        message={message(messageOverride)}
        isStreaming={false}
        participants={options.participants ?? []}
        onRetry={vi.fn()}
        onFork={vi.fn()}
      />
    </AudioPlaybackContext.Provider>,
  );
}

describe("AssistantMessage seam regressions", () => {
  beforeEach(() => {
    convexMocks.resolveDocumentEdit.mockReset().mockResolvedValue({ ok: true });
    convexMocks.undoDocumentEditResolution.mockReset().mockResolvedValue({ ok: true });
  });

  it("renders persisted assistant identity when duplicate participants share a model", () => {
    renderAssistant({
      modelId: "openai/gpt-4o",
      participantId: "reviewer",
      participantName: "Reviewer",
      participantEmoji: "✅",
    }, {
      participants: [
        {
          modelId: "openai/gpt-4o",
          personaId: "planner" as Id<"personas">,
          personaName: "Planner",
          personaEmoji: "P",
        },
        {
          modelId: "openai/gpt-4o",
          personaId: "reviewer" as Id<"personas">,
          personaName: "Reviewer",
          personaEmoji: "R",
        },
      ],
    });

    expect(screen.getByText("Reviewer")).toBeInTheDocument();
    expect(screen.getByText("✅")).toBeInTheDocument();
    expect(screen.queryByText("Planner")).not.toBeInTheDocument();
  });

  it("shows document edit action failures and reenables the action", async () => {
    convexMocks.resolveDocumentEdit.mockRejectedValueOnce(new Error("Resolve failed"));
    renderAssistant({ documentEditAnnotations: [pendingDocumentEdit()] });

    const acceptButton = screen.getByRole("button", { name: "Accept" });
    fireEvent.click(acceptButton);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Resolve failed");
    });
    expect(acceptButton).not.toBeDisabled();
    expect(convexMocks.resolveDocumentEdit).toHaveBeenCalledWith({
      documentId: "doc_1",
      editId: "edit_pending",
      decision: "accept",
    });
  });
});
