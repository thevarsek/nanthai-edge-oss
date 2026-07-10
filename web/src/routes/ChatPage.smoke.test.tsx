import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPage } from "./ChatPage";

const {
  navigate,
  routeState,
  chatState,
  overrideState,
  participantState,
  analyticsMocks,
  updateChat,
  retryMessage,
  addTurnSkillOverride,
} = vi.hoisted(() => ({
  navigate: vi.fn(),
  routeState: { chatId: undefined as string | undefined },
  chatState: {
    chat: null as { title?: string; activeBranchLeafId?: string } | null,
    messages: [] as Array<{ _id: string; role: string; content: string; status: string; createdAt: number }>,
    isLoading: false,
    isGenerating: false,
  },
  overrideState: {
    selectedKBFileIds: new Set<string>(),
    turnSkillOverrides: new Map<string, string>(),
    turnIntegrationOverrides: new Map<string, boolean>(),
    activePanel: null as string | null,
  },
  participantState: {
    participants: [{ id: "participant_1", modelId: "openai/gpt-5.2", personaId: null }],
    isLoading: false,
  },
  analyticsMocks: {
    analyticsErrorLabel: vi.fn((error: unknown) => error instanceof Error ? error.name.toLowerCase() : "unknown_error"),
    captureAnalytics: vi.fn(),
    createAnalyticsClientMetadata: vi.fn(() => ({
      platform: "web",
      surface: "web_app",
      clientEventId: "client-event-1",
      clientSentAt: 123,
    })),
  },
  updateChat: vi.fn(async () => null),
  retryMessage: vi.fn(async () => null),
  addTurnSkillOverride: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ chatId: routeState.chatId }),
  useNavigate: () => navigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/analytics", () => analyticsMocks);

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(async () => ({ accessToken: "token" })),
  useMutation: () => vi.fn(async () => null),
  useQuery: () => undefined,
}));

vi.mock("@/hooks/useChat", () => ({
  useChat: () => ({
    chat: chatState.chat,
    messages: chatState.messages,
    isLoading: chatState.isLoading,
    isGenerating: chatState.isGenerating,
    sendMessage: vi.fn(),
    cancelGeneration: vi.fn(),
    retryMessage,
    updateChat,
    switchBranchAtFork: vi.fn(),
  }),
}));

vi.mock("@/hooks/useBranching", () => ({
  useBranching: () => ({
    activePath: [],
    branchNodes: new Map(),
    navigate: vi.fn(),
    optimisticLeafId: undefined,
    setOptimisticLeafId: vi.fn(),
  }),
}));

vi.mock("@/hooks/useMessageGrouping", () => ({
  useMessageGrouping: () => chatState.messages.map((message) => ({ type: "single", message })),
  messageGroupKey: () => "group",
}));

vi.mock("@/hooks/useSharedData", () => ({
  useConnectedAccounts: () => ({ googleConnection: { hasDrive: false, hasCalendar: false } }),
  useCreditBalance: () => ({ balance: { credits: 12 }, refresh: vi.fn() }),
  useModelSummaries: () => [],
  useSharedData: () => ({
    prefs: {
      defaultModelId: "openai/gpt-5.2",
      showBalanceInChat: true,
      showAdvancedStats: true,
      webSearchEnabledByDefault: false,
    },
    modelSettings: [],
    proStatus: { isPro: true },
    personas: [{ _id: "persona_retry", name: "Retry Persona" }],
  }),
}));

vi.mock("@/hooks/useChatOverrides", () => ({
  useChatOverrides: () => ({
    paramOverrides: { temperatureMode: "default", temperature: 1, maxTokensMode: "default", maxTokens: undefined, reasoningMode: "default", reasoningEffort: "medium", autoAudioResponseMode: "default" },
    setParamOverrides: vi.fn(),
    enabledIntegrations: new Set(),
    enabledSkillIds: new Set(),
    skillOverrides: new Map(),
    integrationOverrides: new Map(),
    selectedKBFileIds: overrideState.selectedKBFileIds,
    turnSkillOverrides: overrideState.turnSkillOverrides,
    turnIntegrationOverrides: overrideState.turnIntegrationOverrides,
    turnSkillOverrideEntries: [],
    turnIntegrationOverrideEntries: [],
    activePanel: overrideState.activePanel,
    badges: {},
    addTurnSkillOverride,
    addTurnIntegrationOverride: vi.fn(),
    removeTurnSkillOverride: vi.fn(),
    removeTurnIntegrationOverride: vi.fn(),
    clearTurnOverrides: vi.fn(),
    clearKBFiles: vi.fn(),
    toggleKBFile: vi.fn(),
    toggleIntegration: vi.fn(),
    toggleSkill: vi.fn(),
    cycleSkill: vi.fn(),
    closePanel: vi.fn(),
    handlePlusMenuSelect: vi.fn(),
    flushPendingState: vi.fn(),
  }),
}));

vi.mock("@/hooks/useParticipants", () => ({
  useParticipants: () => ({
    participants: participantState.participants,
    isLoading: participantState.isLoading,
    addParticipant: vi.fn(),
    removeParticipant: vi.fn(),
    setParticipants: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAutonomous", () => ({
  useAutonomous: () => ({
    state: { status: "paused" },
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

vi.mock("@/hooks/useSearchSessions", () => ({ useSearchSessions: () => ({ sessionMap: new Map() }) }));
vi.mock("@/hooks/useChatCosts", () => ({ useChatCosts: () => ({ messageCosts: {}, totalCost: 1.23, breakdown: [] }) }));
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
vi.mock("@/routes/ChatPage.helpers", () => ({
  useChatScroll: () => undefined,
  useChatSearchWiring: () => ({ scrollContainerRef: { current: null }, searchCtx: { query: "", queryLength: 0, matches: [], focusedGlobalIndex: -1 }, isOpen: false, query: "", setQuery: vi.fn(), matches: [], currentIndex: 0, next: vi.fn(), prev: vi.fn(), close: vi.fn() }),
  useMentionSuggestions: () => [],
  useSearchMode: () => ({ searchMode: { mode: "none", complexity: 1 }, setSearchMode: vi.fn(), globeColor: "text-muted" }),
  useSubagentOverride: () => ({ subagentOverride: "default", effectiveSubagentsEnabled: false, handleSubagentOverrideChange: vi.fn() }),
}));

vi.mock("@/routes/ChatPage.header", () => ({
  ChatHeader: ({ onRename, onToggleIdeascape }: { onRename: () => void; onToggleIdeascape: () => void }) => (
    <div>
      <span>chat-header</span>
      <button type="button" onClick={onRename}>rename-chat</button>
      <button type="button" onClick={onToggleIdeascape}>open-ideascape</button>
    </div>
  ),
  ChatModalPanels: ({ activePanel }: { activePanel: string | null }) => <div>panel:{activePanel ?? "none"}</div>,
  EmptyChatState: () => <div>empty-chat-state</div>,
}));

vi.mock("@/components/chat/MessageInput", () => ({
  MessageInput: ({ onTextChange, disabled }: { onTextChange: (text: string) => void; disabled: boolean }) => (
    <button type="button" disabled={disabled} onClick={() => onTextChange("/")}>message-input</button>
  ),
}));

vi.mock("@/components/chat/MessageBubble", () => ({
  MessageBubble: ({ onRetryWithDifferentModel, message }: { onRetryWithDifferentModel: (id: string) => void; message: { _id: string; content: string } }) => (
    <button type="button" onClick={() => onRetryWithDifferentModel(message._id)}>{message.content}</button>
  ),
}));

vi.mock("@/components/settings/ChatDefaultsSection.ParticipantPicker", () => ({
  ParticipantPicker: ({ onSelectModel, onSelectPersona, onClose }: { onSelectModel: (id: string) => void; onSelectPersona: (id: string) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="retry picker">
      <button type="button" onClick={() => onSelectModel("anthropic/claude")}>retry model</button>
      <button type="button" onClick={() => onSelectPersona("persona_retry")}>retry persona</button>
      <button type="button" onClick={onClose}>close retry</button>
    </div>
  ),
}));

vi.mock("@/components/chat/SlashCommandPalette", () => ({
  SlashCommandPalette: ({ onSelectSkill }: { onSelectSkill: (id: string, name: string) => void }) => (
    <button type="button" onClick={() => onSelectSkill("skill_1", "Planner")}>slash-palette</button>
  ),
  TurnOverrideChips: () => <div>override-chips</div>,
}));

vi.mock("@/components/chat/BalanceIndicator", () => ({
  BalanceIndicator: ({ balance }: { balance: { credits: number } }) => <div>balance:{balance.credits}</div>,
}));

vi.mock("@/components/chat-list/SidebarSections", () => ({
  RenameChatDialog: ({ isOpen, onRename }: { isOpen: boolean; onRename: (title: string) => void }) => (
    isOpen ? <button onClick={() => onRename("Renamed")}>confirm-rename</button> : null
  ),
}));

vi.mock("@/components/shared/LoadingSpinner", () => ({ LoadingSpinner: () => <div role="status">loading</div> }));
vi.mock("@/components/chat/AutonomousToolbar", () => ({ AutonomousToolbar: () => <div>autonomous-toolbar</div> }));
vi.mock("@/components/chat/AutoAudioWatcher", () => ({ AutoAudioWatcher: () => null }));
vi.mock("@/components/chat/MultiModelResponseGroup", () => ({ MultiModelResponseGroup: () => null }));
vi.mock("@/components/chat/PendingResponseGroup", () => ({ PendingResponseGroup: () => null }));
vi.mock("@/components/chat/BranchIndicator", () => ({ BranchIndicator: () => null }));
vi.mock("@/components/shared/Toast.context", () => ({ useToast: () => ({ toast: vi.fn() }) }));

describe("ChatPage composed route smoke", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.clearAllMocks();
    routeState.chatId = undefined;
    chatState.chat = null;
    chatState.messages = [];
    chatState.isLoading = false;
    chatState.isGenerating = false;
    overrideState.activePanel = null;
    participantState.participants = [{ id: "participant_1", modelId: "openai/gpt-5.2", personaId: null }];
    participantState.isLoading = false;
  });

  it("renders the empty chat route shell, composer, balance, and autonomous toolbar", () => {
    render(<ChatPage />);

    expect(screen.getByText("chat-header")).toBeInTheDocument();
    expect(screen.getByText("empty-chat-state")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "message-input" })).toBeInTheDocument();
    expect(screen.getByText("balance:12")).toBeInTheDocument();
    expect(screen.getByText("autonomous-toolbar")).toBeInTheDocument();
  });

  it("shows the initial chat loading shell before rendering a loaded route", () => {
    routeState.chatId = "chat_loading";
    chatState.isLoading = true;

    render(<ChatPage />);

    expect(screen.getByRole("status")).toHaveTextContent("loading");
  });

  it("keeps an existing chat route noninteractive while loading persists", () => {
    vi.useFakeTimers();
    try {
      routeState.chatId = "chat_loading";
      chatState.isLoading = true;

      const { rerender } = render(<ChatPage />);
      expect(screen.getByRole("status")).toHaveTextContent("loading");

      act(() => {
        vi.runAllTimers();
      });
      rerender(<ChatPage />);

      expect(screen.getByRole("status")).toHaveTextContent("loading");
      expect(screen.queryByRole("button", { name: "message-input" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes header actions and rename updates through the current chat id", async () => {
    const user = userEvent.setup();
    routeState.chatId = "chat_active";
    chatState.chat = { title: "Original" };

    render(<ChatPage />);

    await user.click(screen.getByRole("button", { name: "open-ideascape" }));
    expect(navigate).toHaveBeenCalledWith("/app/ideascape/chat_active");

    await user.click(screen.getByRole("button", { name: "rename-chat" }));
    await user.click(screen.getByRole("button", { name: "confirm-rename" }));
    expect(updateChat).toHaveBeenCalledWith({ chatId: "chat_active", title: "Renamed" });
  });

  it("waits for participants before capturing chat opened analytics", async () => {
    routeState.chatId = "chat_active";
    chatState.chat = { title: "Active" };
    chatState.messages = [{ _id: "msg_user", role: "user", content: "Hi", status: "completed", createdAt: 1 }];
    participantState.isLoading = true;
    participantState.participants = [];

    const { rerender } = render(<ChatPage />);

    await waitFor(() => {
      expect(analyticsMocks.captureAnalytics).not.toHaveBeenCalledWith(
        "chat_opened",
        expect.any(Object),
      );
    });

    participantState.isLoading = false;
    participantState.participants = [{ id: "participant_1", modelId: "openai/gpt-5.2", personaId: null }];
    rerender(<ChatPage />);

    await waitFor(() => {
      expect(analyticsMocks.captureAnalytics).toHaveBeenCalledWith(
        "chat_opened",
        expect.objectContaining({
          chat_id: "chat_active",
          message_count: 1,
          participant_count: 1,
        }),
      );
    });
  });

  it("opens slash skill overrides and retry-with-different-model picker from shell callbacks", async () => {
    const user = userEvent.setup();
    routeState.chatId = "chat_active";
    chatState.chat = { title: "Active" };
    chatState.messages = [{ _id: "msg_assistant", role: "assistant", content: "Assistant reply", status: "completed", createdAt: 1 }];

    render(<ChatPage />);

    await user.click(screen.getByRole("button", { name: "message-input" }));
    await user.click(screen.getByRole("button", { name: "slash-palette" }));
    expect(addTurnSkillOverride).toHaveBeenCalledWith("skill_1", "always");

    await user.click(screen.getByRole("button", { name: "Assistant reply" }));
    expect(screen.getByRole("dialog", { name: "retry picker" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "retry model" }));

    await waitFor(() => {
      expect(retryMessage).toHaveBeenCalledWith(expect.objectContaining({
        messageId: "msg_assistant",
        participants: [expect.objectContaining({ modelId: "anthropic/claude", personaId: null })],
      }));
    });
  });
});
