import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { clearChatDraft } from "@/stores/chatDraftStore";
import { CanvasView } from "./IdeascapePage.canvas";

const {
  cancelGeneration,
  clearKBFiles,
  clearTurnOverrides,
  createUploadUrl,
  sendMessage,
  startResearchPaper,
  testState,
  toast,
  updateChat,
  upsertPosition,
  upsertPreferences,
} = vi.hoisted(() => ({
  cancelGeneration: vi.fn(async () => ({ cancelledCount: 1 })),
  clearKBFiles: vi.fn(),
  clearTurnOverrides: vi.fn(),
  createUploadUrl: vi.fn(async () => "https://uploads.example/file"),
  sendMessage: vi.fn(async () => ({ userMessageId: "msg_user", assistantMessageIds: ["msg_assistant"] })),
  startResearchPaper: vi.fn(async () => null),
  toast: vi.fn(),
  updateChat: vi.fn(async () => null),
  upsertPosition: vi.fn(async () => null),
  upsertPreferences: vi.fn(async () => null),
  testState: {
    kbFiles: [] as Array<{
      storageId: string;
      filename: string;
      mimeType: string;
      sizeBytes?: number;
      driveFileId?: string;
      lastRefreshedAt?: number;
    }>,
    overrides: {
      enabledIntegrations: new Set<string>(),
      selectedKBFileIds: new Set<string>(),
    },
  },
}));

const chatId = "chat_ideascape" as Id<"chats">;
const focusedMessageId = "msg_focus" as Id<"messages">;
const participant = {
  id: "participant_1",
  modelId: "openai/gpt-5.2",
  personaId: null,
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    chat: { mutations: { createUploadUrl: "createUploadUrl" } },
    knowledge_base: { queries: { getKnowledgeBaseFilesByStorageIds: "getKnowledgeBaseFilesByStorageIds" } },
    nodePositions: {
      mutations: { upsert: "upsertPosition" },
      queries: { listByChat: "listNodePositionsByChat" },
    },
    preferences: { mutations: { upsertPreferences: "upsertPreferences" } },
    search: { mutations: { startResearchPaper: "startResearchPaper" } },
  },
}));

vi.mock("convex/react", () => ({
  useMutation: (key: string) => {
    if (key === "createUploadUrl") return createUploadUrl;
    if (key === "startResearchPaper") return startResearchPaper;
    if (key === "upsertPosition") return upsertPosition;
    if (key === "upsertPreferences") return upsertPreferences;
    return vi.fn(async () => null);
  },
  useQuery: (key: string, args: unknown) => {
    if (key === "getKnowledgeBaseFilesByStorageIds" && args !== "skip") return testState.kbFiles;
    if (key === "listNodePositionsByChat") return [];
    return undefined;
  },
}));

vi.mock("@/hooks/useChat", () => ({
  useChat: () => ({
    chat: {
      _id: chatId,
      title: "Ideascape",
      mode: "ideascape",
      activeBranchLeafId: focusedMessageId,
      createdAt: 1,
    },
    messages: [{
      _id: focusedMessageId,
      _creationTime: 1,
      chatId,
      role: "user",
      content: "Focused prompt",
      status: "completed",
      createdAt: 1,
    }],
    isLoading: false,
    isGenerating: false,
    sendMessage,
    cancelGeneration,
    updateChat,
  }),
}));

vi.mock("@/hooks/useParticipants", () => ({
  useParticipants: () => ({
    participants: [participant],
    addParticipant: vi.fn(),
    removeParticipant: vi.fn(),
    setParticipants: vi.fn(),
  }),
}));

vi.mock("@/hooks/useSharedData", () => ({
  useConnectedAccounts: () => ({ googleConnection: { hasDrive: true } }),
  useModelSummaries: () => [],
  useSharedData: () => ({
    prefs: {
      defaultModelId: "openai/gpt-5.2",
      hasSeenIdeascapeHelp: true,
      webSearchEnabledByDefault: false,
    },
    modelSettings: [],
    proStatus: { isPro: true },
    personas: [],
  }),
}));

vi.mock("@/hooks/useChatOverrides", () => ({
  useChatOverrides: () => ({
    paramOverrides: {
      temperatureMode: "default",
      temperature: 1,
      maxTokensMode: "default",
      maxTokens: undefined,
      reasoningMode: "default",
      reasoningEffort: "medium",
      autoAudioResponseMode: "default",
    },
    setParamOverrides: vi.fn(),
    enabledIntegrations: testState.overrides.enabledIntegrations,
    enabledSkillIds: new Set(),
    skillOverrides: new Map(),
    integrationOverrides: new Map(),
    selectedKBFileIds: testState.overrides.selectedKBFileIds,
    activePanel: null,
    badges: {},
    clearKBFiles,
    clearTurnOverrides,
    toggleKBFile: vi.fn(),
    toggleIntegration: vi.fn(),
    toggleSkill: vi.fn(),
    cycleSkill: vi.fn(),
    closePanel: vi.fn(),
    handlePlusMenuSelect: vi.fn(),
    flushPendingState: vi.fn(async () => null),
  }),
}));

vi.mock("@/hooks/useAutonomous", () => ({
  useAutonomous: () => ({
    state: { status: "idle" },
    settings: {},
    setSettings: vi.fn(),
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    dismissEnded: vi.fn(),
    intervene: vi.fn(),
  }),
}));

vi.mock("@/components/ideascape/IdeascapeCanvas", () => ({
  IdeascapeCanvas: ({ onFocusNode }: { onFocusNode: (id: string) => void }) => (
    <button type="button" onClick={() => onFocusNode(focusedMessageId)}>ideascape-canvas</button>
  ),
}));

vi.mock("@/routes/ChatPage.header", () => ({
  ChatModalPanels: () => null,
}));

vi.mock("@/components/ideascape/IdeascapeHelpDeck", () => ({
  IdeascapeHelpDeck: () => null,
}));

vi.mock("@/components/shared/LoadingSpinner", () => ({
  LoadingSpinner: () => <div>loading</div>,
}));

vi.mock("@/components/chat/AudioRecordingOverlay", () => ({
  AudioRecordingOverlay: () => null,
}));

vi.mock("@/components/chat/PendingFollowUpCard", () => ({
  PendingFollowUpCard: () => null,
}));

vi.mock("@/components/chat/MentionAutocompletePopover", () => ({
  MentionAutocompletePopover: () => null,
}));

vi.mock("@/components/shared/Toast.context", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("@/components/chat/AudioPlaybackContext", () => ({
  AudioPlaybackProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("IdeascapePage composed send behavior", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    testState.kbFiles = [{
      storageId: "storage_drive",
      filename: "Drive notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 123,
      driveFileId: "drive_file_1",
      lastRefreshedAt: 456,
    }];
    testState.overrides.selectedKBFileIds = new Set(["storage_drive"]);
    testState.overrides.enabledIntegrations = new Set(["drive"]);
    sendMessage.mockResolvedValue({ userMessageId: "msg_user", assistantMessageIds: ["msg_assistant"] });
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearChatDraft(chatId);
  });

  it("sends focused-node replies with de-duplicated Drive context and clears one-turn state", async () => {
    const user = userEvent.setup();

    render(<CanvasView chatId={chatId} />);

    expect(screen.getByText("ideascape-canvas")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ideascape-canvas" }));
    expect(screen.getByText("Drive notes.pdf")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });
    await user.type(screen.getByRole("textbox"), "continue from canvas");
    await user.click(screen.getByTitle("Send (Enter)"));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId,
      text: "continue from canvas",
      explicitParentIds: [focusedMessageId],
      expandMultiModelGroups: false,
      enabledIntegrations: ["drive"],
      attachments: [expect.objectContaining({
        storageId: "storage_drive",
        driveFileId: "drive_file_1",
        lastRefreshedAt: 456,
      })],
    }));
    expect(clearKBFiles).toHaveBeenCalledTimes(1);
    expect(clearTurnOverrides).toHaveBeenCalledTimes(1);
  });
});
