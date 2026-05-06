import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatPage } from "./ChatPage";

vi.mock("react-router-dom", () => ({
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(async () => ({ accessToken: "token" })),
  useMutation: () => vi.fn(async () => null),
  useQuery: () => undefined,
}));

vi.mock("@/hooks/useChat", () => ({
  useChat: () => ({
    chat: null,
    messages: [],
    isLoading: false,
    isGenerating: false,
    sendMessage: vi.fn(),
    cancelGeneration: vi.fn(),
    retryMessage: vi.fn(),
    updateChat: vi.fn(),
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
  useMessageGrouping: () => [],
  messageGroupKey: () => "group",
}));

vi.mock("@/hooks/useSharedData", () => ({
  useConnectedAccounts: () => ({}),
  useCreditBalance: () => ({ balance: undefined, refresh: vi.fn() }),
  useModelSummaries: () => [],
  useSharedData: () => ({
    prefs: { defaultModelId: "openai/gpt-5.2" },
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
    enabledIntegrations: new Set(),
    enabledSkillIds: new Set(),
    skillOverrides: new Map(),
    integrationOverrides: new Map(),
    selectedKBFileIds: new Set(),
    turnSkillOverrides: new Map(),
    turnIntegrationOverrides: new Map(),
    turnSkillOverrideEntries: [],
    turnIntegrationOverrideEntries: [],
    activePanel: null,
    badges: {},
    addTurnSkillOverride: vi.fn(),
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
    participants: [],
    addParticipant: vi.fn(),
    removeParticipant: vi.fn(),
    setParticipants: vi.fn(),
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
  useSearchSessions: () => ({ sessionMap: new Map() }),
}));

vi.mock("@/hooks/useChatCosts", () => ({
  useChatCosts: () => ({ messageCosts: {}, totalCost: null, breakdown: null }),
}));

vi.mock("@/routes/ChatPage.header", () => ({
  ChatHeader: () => <div>chat-header</div>,
  ChatModalPanels: () => null,
  EmptyChatState: () => <div>empty-chat-state</div>,
}));

vi.mock("@/components/chat/MessageInput", () => ({
  MessageInput: () => <div>message-input</div>,
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

vi.mock("@/components/settings/ChatDefaultsSection.ParticipantPicker", () => ({
  ParticipantPicker: () => null,
}));

vi.mock("@/components/shared/LoadingSpinner", () => ({
  LoadingSpinner: () => <div>loading</div>,
}));

vi.mock("@/components/chat/MessageBubble", () => ({ MessageBubble: () => null }));
vi.mock("@/components/chat/MultiModelResponseGroup", () => ({ MultiModelResponseGroup: () => null }));
vi.mock("@/components/chat/PendingResponseGroup", () => ({ PendingResponseGroup: () => null }));
vi.mock("@/components/chat/BranchIndicator", () => ({ BranchIndicator: () => null }));
vi.mock("@/components/chat-list/SidebarSections", () => ({ RenameChatDialog: () => null }));
vi.mock("@/components/shared/Toast.context", () => ({ useToast: () => ({ toast: vi.fn() }) }));

describe("ChatPage composed route smoke", () => {
  it("renders the empty chat route shell and composer", () => {
    Element.prototype.scrollIntoView = vi.fn();

    render(<ChatPage />);

    expect(screen.getByText("chat-header")).toBeInTheDocument();
    expect(screen.getByText("empty-chat-state")).toBeInTheDocument();
    expect(screen.getByText("message-input")).toBeInTheDocument();
  });
});
