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
  ToolCallAccordion: ({ toolCalls, loadedSkillIds, usedIntegrationIds }: {
    toolCalls: unknown[];
    loadedSkillIds?: string[];
    usedIntegrationIds?: string[];
  }) => (
    <div data-testid="tool-accordion">
      tools-{toolCalls.length}-skills-{loadedSkillIds?.length ?? 0}-integrations-{usedIntegrationIds?.length ?? 0}
    </div>
  ),
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

let mockModelSummaries: Array<{ modelId: string; supportsVideo?: boolean }> = [];
vi.mock("@/hooks/useSharedData", () => ({
  useModelSummaries: () => mockModelSummaries,
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

function documentEditAnnotation(
  displayStatus: NonNullable<Message["documentEditAnnotations"]>[number]["displayStatus"],
  overrides: Partial<NonNullable<Message["documentEditAnnotations"]>[number]> = {},
): NonNullable<Message["documentEditAnnotations"]>[number] {
  return {
    type: "docx_edit_proposed",
    editId: `edit_${displayStatus}` as Id<"documentEdits">,
    editBatchId: "batch_1" as Id<"documentEditBatches">,
    generationKey: "generation_1",
    documentId: "doc_1" as Id<"documents">,
    versionId: "version_2" as Id<"documentVersions">,
    baseVersionId: "version_1" as Id<"documentVersions">,
    introducedVersionId: "version_2" as Id<"documentVersions">,
    filename: "contract.docx",
    versionNumber: 2,
    changeId: `change_${displayStatus}`,
    deletedText: "old clause",
    insertedText: "new clause",
    status: displayStatus === "rejected" ? "rejected" : displayStatus === "accepted" ? "accepted" : "pending",
    displayStatus,
    canUndo: false,
    ...overrides,
  };
}

function renderAssistant(messageOverride: Partial<Message>, options: {
  participants?: ComponentProps<typeof AssistantMessage>["participants"];
  onRetry?: () => void;
  onRetryWithDifferentModel?: () => void;
  onFork?: () => void;
  messageCost?: number;
  showAdvancedStats?: boolean;
  onOpenDocumentEdit?: ComponentProps<typeof AssistantMessage>["onOpenDocumentEdit"];
} = {}) {
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

  const view = render(
    <AudioPlaybackContext.Provider value={audio}>
      <AssistantMessage
        message={message(messageOverride)}
        isStreaming={false}
        participants={options.participants ?? []}
        onRetry={options.onRetry ?? vi.fn()}
        onRetryWithDifferentModel={options.onRetryWithDifferentModel}
        onFork={options.onFork ?? vi.fn()}
        messageCost={options.messageCost}
        showAdvancedStats={options.showAdvancedStats}
        onOpenDocumentEdit={options.onOpenDocumentEdit}
      />
    </AudioPlaybackContext.Provider>,
  );
  return { ...view, audio };
}

describe("AssistantMessage", () => {
  beforeEach(() => {
    mockModelSummaries = [];
    convexMocks.resolveDocumentEdit.mockClear();
    convexMocks.undoDocumentEditResolution.mockClear();
  });

  it("copies generated image URLs instead of hidden placeholder text", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderAssistant({
      content: "[Generated image]",
      imageUrls: ["https://example.com/image.png"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://example.com/image.png");
    });
  });

  it("copies generated video URLs instead of hidden placeholder text", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderAssistant({
      content: "[Generated video]",
      videoUrls: ["https://example.com/video.mp4"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://example.com/video.mp4");
    });
  });

  it("shows a video placeholder for pending video generations", () => {
    mockModelSummaries = [{ modelId: "x-ai/grok-imagine-video", supportsVideo: true }];

    renderAssistant({
      content: "",
      status: "pending",
      modelId: "x-ai/grok-imagine-video",
    });

    expect(screen.getByText("Generating video...")).toBeInTheDocument();
  });

  it("does not render unsafe generated media URLs", () => {
    renderAssistant({
      content: "[Generated image]",
      imageUrls: ["javascript:alert(1)"],
      videoUrls: ["javascript:alert(2)"],
    });

    expect(screen.queryByAltText("Generated image")).not.toBeInTheDocument();
    expect(document.querySelector("video")).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="javascript:"]')).not.toBeInTheDocument();
  });

  it("surfaces failure actions without requiring completed message content", () => {
    const onRetry = vi.fn();
    const onRetryWithDifferentModel = vi.fn();

    renderAssistant({ content: "", status: "failed" }, { onRetry, onRetryWithDifferentModel });

    expect(screen.getByText(/Generation failed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry with different model" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetryWithDifferentModel).toHaveBeenCalledTimes(1);
  });

  it("renders parent-owned generated artifacts, tools, subagents, attachments, audio, and advanced cost", async () => {
    const audioStorageId = "audio_storage" as Id<"_storage">;
    const view = renderAssistant({
      modelId: "openai/gpt-4.1",
      toolCalls: [{ id: "tool_1", name: "read_document", arguments: "{}" }],
      loadedSkillIds: ["skill_1" as Id<"skills">],
      usedIntegrationIds: ["google"],
      subagentBatchId: "batch_1" as Id<"subagentBatches">,
      generatedFileIds: ["file_1" as Id<"generatedFiles">],
      generatedChartIds: ["chart_1" as Id<"generatedCharts">],
      attachments: [{ storageId: "storage_1" as Id<"_storage">, name: "notes.pdf", type: "document" }],
      audioStorageId,
    }, { messageCost: 0.0123, showAdvancedStats: true });

    expect(screen.getByTestId("tool-accordion")).toHaveTextContent("tools-1-skills-1-integrations-1");
    expect(screen.getByTestId("subagent-batch")).toHaveTextContent("batch_1");
    expect(screen.getByTestId("generated-files")).toHaveTextContent("message_1");
    expect(screen.getByTestId("generated-charts")).toHaveTextContent("message_1");
    expect(screen.getByTestId("attachments")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "audio-player" }));
    expect(view.audio.play).toHaveBeenCalledWith("message_1", audioStorageId);
    await waitFor(() => expect(view.container).toHaveTextContent("$0.0123"));
  });

  it("expands moderator guidance and opens document citation details", () => {
    renderAssistant({
      moderatorDirective: "Keep the answer short",
      documentCitations: [{
        ref: 1,
        documentId: "doc_1" as Id<"documents">,
        versionId: "version_1" as Id<"documentVersions">,
        filename: "handbook.pdf",
        quote: "Quote body",
        page: 4,
      }],
    });

    fireEvent.click(screen.getByRole("button", { name: /Moderator Guidance/ }));
    expect(screen.getByText("Keep the answer short")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /\[1\].*handbook\.pdf/ }));
    expect(screen.getByText(/source/i)).toBeInTheDocument();
    expect(screen.getAllByText("handbook.pdf")).toHaveLength(2);
    expect(screen.getByText(/Quote body/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(screen.queryByText(/Quote body/)).not.toBeInTheDocument();
  });

  it("renders hydrated DOCX edit card states and wires backend actions", async () => {
    const onOpenDocumentEdit = vi.fn();
    renderAssistant({
      documentEditAnnotations: [
        documentEditAnnotation("pending"),
        documentEditAnnotation("accepted", {
          editId: "edit_accepted" as Id<"documentEdits">,
          status: "accepted",
          canUndo: true,
        }),
        documentEditAnnotation("superseded", {
          editId: "edit_superseded" as Id<"documentEdits">,
        }),
        documentEditAnnotation("unavailable", {
          editId: "edit_unavailable" as Id<"documentEdits">,
          unavailableReason: "Missing version",
        }),
      ],
    }, { onOpenDocumentEdit });

    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.getByText("Superseded")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => {
      expect(convexMocks.resolveDocumentEdit).toHaveBeenCalledWith({
        documentId: "doc_1",
        editId: "edit_pending",
        decision: "accept",
      });
    });
    expect(onOpenDocumentEdit).toHaveBeenCalledWith(
      expect.objectContaining({ editId: "edit_pending" }),
      expect.objectContaining({ _id: "message_1" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(convexMocks.undoDocumentEditResolution).toHaveBeenCalledWith({
        documentId: "doc_1",
        editId: "edit_accepted",
      });
    });

    expect(screen.queryByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
  });
});
