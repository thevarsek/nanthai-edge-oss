import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { clearChatDraft } from "@/stores/chatDraftStore";
import { ChatPage } from "./ChatPage";

const {
  addParticipant,
  attachPickedDriveFiles,
  cancelGeneration,
  cancelSession,
  captureAnalytics,
  clearKBFiles,
  clearTurnOverrides,
  createChat,
  createUploadUrl,
  forkChat,
  getDrivePickerAccessToken,
  navigate,
  removeParticipant,
  retryMessage,
  routeState,
  sendMessage,
  setParticipants,
  startResearchPaper,
  switchBranchAtFork,
  toast,
  updateChat,
  testState,
} = vi.hoisted(() => ({
  addParticipant: vi.fn(),
  attachPickedDriveFiles: vi.fn(async () => null),
  cancelGeneration: vi.fn(async () => ({ cancelledCount: 1 })),
  cancelSession: vi.fn(async () => null),
  captureAnalytics: vi.fn(),
  clearKBFiles: vi.fn(),
  clearTurnOverrides: vi.fn(),
  createChat: vi.fn(async () => "chat_created"),
  createUploadUrl: vi.fn(async () => "https://uploads.example/file"),
  forkChat: vi.fn(async () => "chat_forked"),
  getDrivePickerAccessToken: vi.fn(async () => ({ accessToken: "token" })),
  navigate: vi.fn(),
  removeParticipant: vi.fn(),
  retryMessage: vi.fn(async () => ({ assistantMessageIds: [] })),
  routeState: {
    chatId: "chat_1" as string | undefined,
  },
  sendMessage: vi.fn(async () => ({ userMessageId: "msg_user", assistantMessageIds: ["msg_assistant"] })),
  setParticipants: vi.fn(),
  startResearchPaper: vi.fn(async () => null),
  switchBranchAtFork: vi.fn(async () => "msg_leaf"),
  toast: vi.fn(),
  updateChat: vi.fn(async () => null),
  testState: {
    isLoading: false,
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
      turnSkillOverrideEntries: [] as Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>,
      turnIntegrationOverrideEntries: [] as Array<{ integrationId: string; enabled: boolean }>,
    },
    messages: [] as Array<{
      _id: Id<"messages">;
      chatId: Id<"chats">;
      role: "user" | "assistant";
      content: string;
      status: "completed";
      createdAt: number;
      searchSessionId?: Id<"searchSessions">;
    }>,
    branchNodes: new Map<Id<"messages">, { messageId: Id<"messages"> }>(),
    sessionMap: new Map<string, {
      chatId: Id<"chats">;
      assistantMessageId: Id<"messages">;
      mode: "web" | "paper";
    }>(),
    navigateBranch: vi.fn(),
    setOptimisticLeafId: vi.fn(),
  },
}));

const participant = {
  id: "participant_1",
  modelId: "openai/gpt-5.2",
  personaId: null,
};

vi.mock("react-router-dom", () => ({
  useParams: () => ({ chatId: routeState.chatId }),
  useNavigate: () => navigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    chat: {
      manage: {
        forkChat: "forkChat",
        switchBranchAtFork: "switchBranchAtFork",
      },
      mutations: {
        createChat: "createChat",
        createUploadUrl: "createUploadUrl",
      },
      queries: {
        getMessageAudioUrl: "getMessageAudioUrl",
      },
    },
    drive_picker: { actions: { attachPickedDriveFiles: "attachPickedDriveFiles" } },
    knowledge_base: { queries: { getKnowledgeBaseFilesByStorageIds: "getKnowledgeBaseFilesByStorageIds" } },
    oauth: { google: { getDrivePickerAccessToken: "getDrivePickerAccessToken" } },
    search: {
      mutations: {
        cancelResearchPaper: "cancelResearchPaper",
        regeneratePaper: "regeneratePaper",
        startResearchPaper: "startResearchPaper",
      },
    },
  },
}));

vi.mock("convex/react", () => ({
  useAction: (key: string) => {
    if (key === "getDrivePickerAccessToken") return getDrivePickerAccessToken;
    if (key === "attachPickedDriveFiles") return attachPickedDriveFiles;
    return vi.fn(async () => null);
  },
  useMutation: (key: string) => {
    if (key === "createChat") return createChat;
    if (key === "createUploadUrl") return createUploadUrl;
    if (key === "forkChat") return forkChat;
    if (key === "switchBranchAtFork") return switchBranchAtFork;
    if (key === "cancelResearchPaper") return cancelSession;
    if (key === "startResearchPaper") return startResearchPaper;
    return vi.fn(async () => null);
  },
  useQuery: (key: string, args: unknown) => {
    if (key === "getKnowledgeBaseFilesByStorageIds" && args !== "skip") return testState.kbFiles;
    return undefined;
  },
}));

vi.mock("@/lib/analytics", () => ({
  analyticsErrorLabel: (error: unknown) => error instanceof Error ? error.name.toLowerCase() : "unknown_error",
  captureAnalytics,
  createAnalyticsClientMetadata: (event: string) => ({
    platform: "web",
    surface: "web_app",
    clientEventId: `${event}_id`,
    clientSentAt: 123,
  }),
}));

vi.mock("@/hooks/useChat", () => ({
  useChat: () => ({
    chat: {
      _id: "chat_1",
      title: "Test chat",
      mode: "chat",
      createdAt: 1,
    },
    messages: testState.messages,
    isLoading: testState.isLoading,
    isGenerating: false,
    sendMessage,
    cancelGeneration,
    retryMessage,
    updateChat,
    switchBranchAtFork,
  }),
}));

vi.mock("@/hooks/useBranching", () => ({
  useBranching: () => ({
    activePath: [],
    branchNodes: testState.branchNodes,
    navigate: testState.navigateBranch,
    optimisticLeafId: undefined,
    setOptimisticLeafId: testState.setOptimisticLeafId,
  }),
}));

vi.mock("@/hooks/useMessageGrouping", () => ({
  useMessageGrouping: (messages: typeof testState.messages) => messages.map((message) => ({ type: "single", message })),
  messageGroupKey: () => "group",
}));

vi.mock("@/hooks/useSharedData", () => ({
  useConnectedAccounts: () => ({ googleConnection: { hasDrive: true } }),
  useCreditBalance: () => ({ balance: undefined, refresh: vi.fn() }),
  useModelSummaries: () => [],
  useSharedData: () => ({
    prefs: {
      defaultModelId: "openai/gpt-5.2",
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
    turnSkillOverrides: new Map(),
    turnIntegrationOverrides: new Map(),
    turnSkillOverrideEntries: testState.overrides.turnSkillOverrideEntries,
    turnIntegrationOverrideEntries: testState.overrides.turnIntegrationOverrideEntries,
    activePanel: null,
    badges: {},
    addTurnSkillOverride: vi.fn(),
    addTurnIntegrationOverride: vi.fn(),
    removeTurnSkillOverride: vi.fn(),
    removeTurnIntegrationOverride: vi.fn(),
    clearTurnOverrides,
    clearKBFiles,
    toggleKBFile: vi.fn(),
    toggleIntegration: vi.fn(),
    toggleSkill: vi.fn(),
    cycleSkill: vi.fn(),
    closePanel: vi.fn(),
    handlePlusMenuSelect: vi.fn(),
    flushPendingState: vi.fn(async () => null),
  }),
}));

vi.mock("@/hooks/useParticipants", () => ({
  useParticipants: () => ({
    participants: [participant],
    addParticipant,
    removeParticipant,
    setParticipants,
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

vi.mock("@/hooks/useSearchSessions", () => ({
  useSearchSessions: () => ({ sessionMap: testState.sessionMap }),
}));

vi.mock("@/hooks/useChatCosts", () => ({
  useChatCosts: () => ({ messageCosts: {}, totalCost: null, breakdown: null }),
}));

vi.mock("@/hooks/useAdvisorComposer", () => ({
  useAdvisorComposer: () => ({
    state: { surface: "closed", selections: [], brief: "", defaultAllowWebSearch: false, defaultKeepAvailable: false, saveError: null }, participantCount: 1,
    selectedPersonas: [], persistedPersonaIds: new Set(), participantPersonaIds: new Set(), advisorSelections: undefined, advisorBrief: undefined,
    open: vi.fn(), close: vi.fn(), togglePersona: vi.fn(), updateSelection: vi.fn(), remove: vi.fn(),
    setBrief: vi.fn(), setDefaultAllowWebSearch: vi.fn(), setDefaultKeepAvailable: vi.fn(), save: vi.fn(),
    canSendCurrentSelection: true, canCaptureQueuedSnapshot: true,
    captureQueuedSnapshot: vi.fn(() => ({ advisorSelections: [] })), restoreQueuedSnapshot: vi.fn(), completeSuccessfulSend: vi.fn(),
  }),
}));

vi.mock("@/routes/ChatPage.header", () => ({
  ChatHeader: () => <div>chat-header</div>,
  ChatModalPanels: () => null,
  EmptyChatState: () => <div>empty-chat-state</div>,
}));

vi.mock("@/components/chat/AutonomousToolbar", () => ({
  AutonomousToolbar: () => null,
}));

vi.mock("@/components/chat/BalanceIndicator", () => ({
  BalanceIndicator: () => null,
}));

vi.mock("@/components/chat/SlashCommandPalette", () => ({
  SlashCommandPalette: () => null,
  TurnOverrideChips: () => null,
}));

vi.mock("@/components/chat/AutoAudioWatcher", () => ({
  AutoAudioWatcher: () => null,
}));

vi.mock("@/components/chat/AudioPlaybackContext", () => ({
  AudioPlaybackProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/settings/ChatDefaultsSection.ParticipantPicker", () => ({
  ParticipantPicker: () => null,
}));

vi.mock("@/components/shared/LoadingSpinner", () => ({
  LoadingSpinner: () => <div>loading</div>,
}));

vi.mock("@/components/chat/MessageBubble", async () => {
  const { useSearchSessionContext } = await vi.importActual<typeof import("@/components/chat/SearchSessionContext")>(
    "@/components/chat/SearchSessionContext",
  );
  return {
    MessageBubble: ({ message, onOpenGeneratedFile }: {
      message: { _id: string; searchSessionId?: string; content?: string };
      onOpenGeneratedFile?: (request: {
        file: {
          _id: string;
          filename: string;
          mimeType: string;
          presentationProjectId: string;
          presentationRevision: number;
        };
        message: unknown;
      }) => void;
    }) => {
      const { onCancel } = useSearchSessionContext();
      if (message.content === "deck") {
        return (
          <button type="button" onClick={() => onOpenGeneratedFile?.({
            file: {
              _id: "generated_deck",
              filename: "Launch plan.pptx",
              mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              presentationProjectId: "presentation_1",
              presentationRevision: 7,
            },
            message,
          })}>open-deck</button>
        );
      }
      if (!message.searchSessionId) return null;
      return (
        <button type="button" onClick={() => onCancel(message.searchSessionId!)}>
          cancel-session
        </button>
      );
    },
  };
});
vi.mock("@/components/chat/MultiModelResponseGroup", () => ({ MultiModelResponseGroup: () => null }));
vi.mock("@/components/chat/PendingResponseGroup", () => ({ PendingResponseGroup: () => null }));
vi.mock("@/components/chat/BranchIndicator", () => ({
  BranchIndicator: ({ node, onNavigate }: {
    node: { messageId: Id<"messages"> };
    onNavigate: (messageId: Id<"messages">, direction: "prev" | "next") => void;
  }) => (
    <button type="button" onClick={() => onNavigate(node.messageId, "next")}>branch-next</button>
  ),
}));
vi.mock("@/components/chat/PresentationArtifactPanel", () => ({
  PresentationArtifactPanel: ({ onStageContext }: {
    onStageContext: (target: {
      context: {
        projectId: string;
        projectRevision: number;
        slideId: string;
        slideRevision: number;
        elementId: string;
      };
      label: string;
    }) => void;
  }) => (
    <button type="button" onClick={() => onStageContext({
      context: {
        projectId: "presentation_1",
        projectRevision: 7,
        slideId: "slide-2",
        slideRevision: 4,
        elementId: "headline",
      },
      label: "Launch plan.pptx · Slide 2 · headline",
    })}>stage-presentation</button>
  ),
}));
vi.mock("@/components/chat-list/SidebarSections", () => ({ RenameChatDialog: () => null }));
vi.mock("@/components/shared/Toast.context", () => ({ useToast: () => ({ toast }) }));

describe("ChatPage composed send behavior", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    routeState.chatId = "chat_1";
    testState.isLoading = false;
    testState.kbFiles = [];
    testState.overrides.enabledIntegrations = new Set();
    testState.overrides.selectedKBFileIds = new Set();
    testState.overrides.turnSkillOverrideEntries = [];
    testState.overrides.turnIntegrationOverrideEntries = [];
    testState.messages = [];
    testState.branchNodes = new Map();
    testState.sessionMap = new Map();
    testState.navigateBranch.mockReset();
    testState.setOptimisticLeafId.mockReset();
    sendMessage.mockResolvedValue({ userMessageId: "msg_user", assistantMessageIds: ["msg_assistant"] });
    switchBranchAtFork.mockResolvedValue("msg_leaf");
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearChatDraft("chat_1");
  });

  it("keeps a stable hook order while an existing chat hydrates", () => {
    testState.isLoading = true;
    const view = render(<ChatPage />);

    expect(screen.getByText("loading")).toBeInTheDocument();

    testState.isLoading = false;
    view.rerender(<ChatPage />);

    expect(screen.getByText("empty-chat-state")).toBeInTheDocument();
  });

  it("sends selected Drive context, clears one-turn state, and does not leak it into the next send", async () => {
    const user = userEvent.setup();
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
    testState.overrides.turnSkillOverrideEntries = [{ skillId: "skill_1" as Id<"skills">, state: "always" }];
    testState.overrides.turnIntegrationOverrideEntries = [{ integrationId: "drive", enabled: true }];

    const view = render(<ChatPage />);

    expect(screen.getByText("Drive notes.pdf")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox"), "use Drive context");
    await user.click(screen.getByTitle("Send (Enter)"));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: "use Drive context",
      enabledIntegrations: ["drive"],
      turnSkillOverrides: [{ skillId: "skill_1", state: "always" }],
      turnIntegrationOverrides: [{ integrationId: "drive", enabled: true }],
      attachments: [expect.objectContaining({
        storageId: "storage_drive",
        driveFileId: "drive_file_1",
        lastRefreshedAt: 456,
      })],
    }));
    expect(clearKBFiles).toHaveBeenCalledTimes(1);
    expect(clearTurnOverrides).toHaveBeenCalledTimes(1);

    testState.kbFiles = [];
    testState.overrides.selectedKBFileIds = new Set();
    testState.overrides.enabledIntegrations = new Set();
    testState.overrides.turnSkillOverrideEntries = [];
    testState.overrides.turnIntegrationOverrideEntries = [];
    view.rerender(<ChatPage />);

    await user.type(screen.getByRole("textbox"), "normal turn");
    await user.click(screen.getByTitle("Send (Enter)"));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    const sendCalls = sendMessage.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const secondArgs = sendCalls[1]?.[0];
    expect(secondArgs).toBeDefined();
    expect(secondArgs).toMatchObject({ text: "normal turn", attachments: [] });
    expect(secondArgs?.enabledIntegrations).toBeUndefined();
    expect(secondArgs?.turnSkillOverrides).toBeUndefined();
    expect(secondArgs?.turnIntegrationOverrides).toBeUndefined();
  });

  it("keeps composer state and selected context when send rejects", async () => {
    const user = userEvent.setup();
    sendMessage.mockRejectedValueOnce(new Error("send failed"));
    testState.kbFiles = [{
      storageId: "storage_drive",
      filename: "Drive notes.pdf",
      mimeType: "application/pdf",
      driveFileId: "drive_file_1",
    }];
    testState.overrides.selectedKBFileIds = new Set(["storage_drive"]);
    testState.overrides.enabledIntegrations = new Set(["drive"]);

    render(<ChatPage />);

    await user.type(screen.getByRole("textbox"), "retry this");
    await user.click(screen.getByTitle("Send (Enter)"));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("textbox")).toHaveValue("retry this");
    expect(screen.getByText("Drive notes.pdf")).toBeInTheDocument();
    expect(clearKBFiles).not.toHaveBeenCalled();
    expect(clearTurnOverrides).not.toHaveBeenCalled();
  });

  it("opens a generated deck in the existing side panel and sends its staged target once", async () => {
    const user = userEvent.setup();
    testState.messages = [{
      _id: "msg_deck" as Id<"messages">,
      chatId: "chat_1" as Id<"chats">,
      role: "assistant",
      content: "deck",
      status: "completed",
      createdAt: 1,
    }];
    render(<ChatPage />);

    await user.click(screen.getByRole("button", { name: "open-deck" }));
    await user.click(screen.getByRole("button", { name: "stage-presentation" }));
    expect(screen.getByTestId("presentation-context-chip")).toHaveTextContent("Slide 2");

    await user.type(screen.getByRole("textbox"), "Make the headline sharper");
    await user.click(screen.getByTitle("Send (Enter)"));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: "Make the headline sharper",
      presentationContext: {
        projectId: "presentation_1",
        projectRevision: 7,
        slideId: "slide-2",
        slideRevision: 4,
        elementId: "headline",
      },
    })));
    expect(screen.queryByTestId("presentation-context-chip")).not.toBeInTheDocument();
  });

  it("ignores stale branch switch completions that resolve out of order", async () => {
    const user = userEvent.setup();
    let resolveFirst: (leafId: Id<"messages">) => void = () => {};
    let resolveSecond: (leafId: Id<"messages">) => void = () => {};
    switchBranchAtFork
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve as (leafId: Id<"messages">) => void;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecond = resolve as (leafId: Id<"messages">) => void;
      }));
    testState.messages = [{
      _id: "msg_fork" as Id<"messages">,
      chatId: "chat_1" as Id<"chats">,
      role: "assistant",
      content: "fork",
      status: "completed",
      createdAt: 1,
    }];
    testState.branchNodes = new Map([[
      "msg_fork" as Id<"messages">,
      { messageId: "msg_fork" as Id<"messages"> },
    ]]);
    testState.navigateBranch
      .mockReturnValueOnce({
        optimisticLeafId: "leaf_first_pending",
        currentSiblingId: "sibling_current",
        targetSiblingId: "sibling_first",
      })
      .mockReturnValueOnce({
        optimisticLeafId: "leaf_second_pending",
        currentSiblingId: "sibling_current",
        targetSiblingId: "sibling_second",
      });

    render(<ChatPage />);
    testState.setOptimisticLeafId.mockClear();

    await user.click(screen.getByRole("button", { name: "branch-next" }));
    await user.click(screen.getByRole("button", { name: "branch-next" }));

    expect(testState.setOptimisticLeafId).toHaveBeenCalledWith("leaf_first_pending");
    expect(testState.setOptimisticLeafId).toHaveBeenCalledWith("leaf_second_pending");

    await act(async () => {
      resolveSecond("leaf_second_committed" as Id<"messages">);
    });
    await waitFor(() => {
      expect(testState.setOptimisticLeafId).toHaveBeenCalledWith("leaf_second_committed");
    });

    await act(async () => {
      resolveFirst("leaf_first_committed" as Id<"messages">);
    });

    expect(testState.setOptimisticLeafId).not.toHaveBeenCalledWith("leaf_first_committed");
  });

  it("logs the actual search session mode when cancelling search progress", async () => {
    const user = userEvent.setup();
    testState.sessionMap = new Map([
      ["session_web", {
        chatId: "chat_1" as Id<"chats">,
        assistantMessageId: "msg_search" as Id<"messages">,
        mode: "web",
      }],
    ]);
    testState.messages = [{
      _id: "msg_search" as Id<"messages">,
      chatId: "chat_1" as Id<"chats">,
      role: "assistant",
      content: "searching",
      status: "completed",
      createdAt: 1,
      searchSessionId: "session_web" as Id<"searchSessions">,
    }];

    render(<ChatPage />);
    await user.click(screen.getByRole("button", { name: "cancel-session" }));

    await waitFor(() => expect(cancelSession).toHaveBeenCalledWith({ sessionId: "session_web" }));
    expect(captureAnalytics).toHaveBeenCalledWith(
      "generation_cancelled",
      expect.objectContaining({
        chat_id: "chat_1",
        message_id: "msg_search",
        session_id: "session_web",
        search_mode: "web",
      }),
    );
  });
});
