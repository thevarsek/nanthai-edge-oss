import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { CanvasView } from "./IdeascapePage.canvas";

const advisorMocks = vi.hoisted(() => ({
  captureQueuedSnapshot: vi.fn(() => ({
    advisorSelections: [{ personaId: "advisor_queued", allowWebSearch: false, keepAvailable: false }],
    advisorBrief: "queued brief",
  })),
  canSendCurrentSelection: true,
  canCaptureQueuedSnapshot: true,
  restoreQueuedSnapshot: vi.fn(),
  completeSuccessfulSend: vi.fn(),
}));

vi.mock("@/hooks/useAdvisorComposer", () => ({
  useAdvisorComposer: () => ({
    state: { chatKey: "chat_canvas", surface: "closed", selections: [], brief: "", defaultAllowWebSearch: false, defaultKeepAvailable: false, saveError: null, isSaving: false, isHydrated: true }, participantCount: 1,
    isHydrated: true, unavailablePersonaIds: new Set(), selectedPersonas: [], persistedPersonaIds: new Set(), participantPersonaIds: new Set(),
    advisorSelections: [{ personaId: "advisor_live", allowWebSearch: true, keepAvailable: false }], advisorBrief: "live brief",
    open: vi.fn(), close: vi.fn(), togglePersona: vi.fn(), updateSelection: vi.fn(), remove: vi.fn(),
    setBrief: vi.fn(), setDefaultAllowWebSearch: vi.fn(), setDefaultKeepAvailable: vi.fn(), save: vi.fn(),
    captureQueuedSnapshot: advisorMocks.captureQueuedSnapshot,
    canSendCurrentSelection: advisorMocks.canSendCurrentSelection,
    canCaptureQueuedSnapshot: advisorMocks.canCaptureQueuedSnapshot,
    restoreQueuedSnapshot: advisorMocks.restoreQueuedSnapshot,
    completeSuccessfulSend: advisorMocks.completeSuccessfulSend,
  }),
}));

const {
  state,
  cancelGeneration,
  clearKBFiles,
  clearTurnOverrides,
  sendMessage,
  startResearchPaper,
  toast,
  updateChat,
  upsertPosition,
  upsertPreferences,
} = vi.hoisted(() => ({
  state: {
    chat: { _id: "chat_canvas", title: "Canvas Chat", activeBranchLeafId: null as string | null, activeBranchLeafFocusOrder: 0 },
    isLoading: false,
    messages: [] as Array<{ _id: string; role: string; content: string; status: string; createdAt: number; parentMessageIds?: string[] }>,
    participants: [{ id: "p1", modelId: "openai/gpt-4.1", personaId: null as string | null }],
    positions: [] as Array<{ messageId: string; x: number; y: number; width?: number; height?: number }>,
    prefs: { defaultModelId: "openai/gpt-4.1", hasSeenIdeascapeHelp: true, webSearchEnabledByDefault: false } as
      | { defaultModelId: string; hasSeenIdeascapeHelp: boolean; webSearchEnabledByDefault: boolean }
      | undefined,
    selectedKBFileIds: new Set<string>(),
    searchMode: { mode: "none", complexity: 1 },
  },
  cancelGeneration: vi.fn(async () => null),
  clearKBFiles: vi.fn(),
  clearTurnOverrides: vi.fn(),
  sendMessage: vi.fn(async () => null),
  startResearchPaper: vi.fn(async () => null),
  toast: vi.fn(),
  updateChat: vi.fn(async (): Promise<{ activeBranchLeafApplied?: boolean; activeBranchLeafId?: string | null }> => ({
    activeBranchLeafApplied: true,
  })),
  upsertPosition: vi.fn(async () => null),
  upsertPreferences: vi.fn(async () => null),
}));

const chatId = "chat_canvas" as Id<"chats">;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, options?: { count?: number }) => options?.count ? `${key}:${options.count}` : key }),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    chat: { mutations: { createUploadUrl: "createUploadUrl" } },
    knowledge_base: { queries: { getKnowledgeBaseFilesByStorageIds: "kbFiles" } },
    nodePositions: { mutations: { upsert: "upsertPosition" }, queries: { listByChat: "positions" } },
    preferences: { mutations: { upsertPreferences: "upsertPreferences" } },
    search: { mutations: { startResearchPaper: "startResearchPaper" } },
  },
}));

vi.mock("convex/react", () => ({
  useMutation: (key: string) => {
    if (key === "upsertPosition") return upsertPosition;
    if (key === "upsertPreferences") return upsertPreferences;
    if (key === "startResearchPaper") return startResearchPaper;
    return vi.fn(async () => "upload-url");
  },
  useQuery: (key: string, args: unknown) => {
    if (key === "positions") return state.positions;
    if (key === "kbFiles" && args !== "skip") return [];
    return undefined;
  },
}));

vi.mock("@/hooks/useChat", () => ({
  useChat: () => ({
    chat: state.chat,
    messages: state.messages,
    isLoading: state.isLoading,
    isGenerating: false,
    sendMessage,
    cancelGeneration,
    updateChat,
  }),
}));

vi.mock("@/hooks/useParticipants", () => ({
  useParticipants: () => ({
    participants: state.participants,
    addParticipant: vi.fn(),
    removeParticipant: vi.fn(),
    setParticipants: vi.fn(),
  }),
}));

vi.mock("@/hooks/useSharedData", () => ({
  useConnectedAccounts: () => ({ googleConnection: { hasDrive: true }, gmailManualConnection: { status: "active" } }),
  useModelSummaries: () => [{ modelId: "openai/gpt-4.1", supportsVideo: false }],
  useSharedData: () => ({ prefs: state.prefs, modelSettings: [], proStatus: { isPro: true }, personas: [] }),
}));

vi.mock("@/hooks/useChatOverrides", () => ({
  useChatOverrides: () => ({
    paramOverrides: {},
    setParamOverrides: vi.fn(),
    enabledIntegrations: new Set(),
    enabledSkillIds: new Set(),
    skillOverrides: new Map(),
    selectedKBFileIds: state.selectedKBFileIds,
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

vi.mock("@/routes/ChatPage.helpers", () => ({
  useMentionSuggestions: () => [],
  useSearchMode: () => ({ searchMode: state.searchMode, setSearchMode: vi.fn(), globeColor: "muted" }),
  useSubagentOverride: () => ({ subagentOverride: "default", effectiveSubagentsEnabled: false, handleSubagentOverrideChange: vi.fn() }),
}));

vi.mock("@/components/ideascape/IdeascapeCanvas", () => ({
  IdeascapeCanvas: ({ onNodeDragEnd, onNodeResizeEnd, onSelectNode, onFocusNode }: {
    onNodeDragEnd: (id: string, x: number, y: number) => void;
    onNodeResizeEnd: (id: string, width: number, height: number) => void;
    onSelectNode: (id: string, multi: boolean) => void;
    onFocusNode: (id: string) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSelectNode("msg_root", false)}>select-root</button>
      <button type="button" onClick={() => onSelectNode("msg_child", true)}>multi-child</button>
      <button type="button" onClick={() => onFocusNode("msg_root")}>focus-root</button>
      <button type="button" onClick={() => onNodeDragEnd("msg_root", 20, 30)}>drag-root</button>
      <button type="button" onClick={() => onNodeResizeEnd("msg_child", 320, 180)}>resize-child</button>
    </div>
  ),
}));

vi.mock("@/components/chat/MessageInput", () => ({
  MessageInput: ({ disabled, onSend, captureQueuedAdvisorSnapshot, restoreQueuedAdvisorSnapshot }: {
    disabled: boolean;
    onSend: (args: { text: string; advisorSnapshot?: ReturnType<typeof advisorMocks.captureQueuedSnapshot> }) => Promise<boolean>;
    captureQueuedAdvisorSnapshot?: typeof advisorMocks.captureQueuedSnapshot;
    restoreQueuedAdvisorSnapshot?: typeof advisorMocks.restoreQueuedSnapshot;
  }) => (
    <div>
      <button type="button" disabled={disabled} onClick={() => void onSend({ text: "continue" })}>send-from-canvas</button>
      <button
        type="button"
        disabled={disabled || !captureQueuedAdvisorSnapshot || !restoreQueuedAdvisorSnapshot}
        onClick={() => void onSend({ text: "queued", advisorSnapshot: captureQueuedAdvisorSnapshot?.() })}
      >
        send-queued-from-canvas
      </button>
    </div>
  ),
}));

vi.mock("@/components/ideascape/IdeascapeHelpDeck", () => ({
  IdeascapeHelpDeck: ({ onDismiss }: { onDismiss: () => void }) => <button type="button" onClick={onDismiss}>dismiss-help</button>,
}));

vi.mock("@/routes/ChatPage.header", () => ({ ChatModalPanels: () => null }));
vi.mock("@/components/shared/Toast.context", () => ({ useToast: () => ({ toast }) }));

describe("CanvasView shell branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.chat = { _id: "chat_canvas", title: "Canvas Chat", activeBranchLeafId: null, activeBranchLeafFocusOrder: 0 };
    state.isLoading = false;
    state.messages = [];
    state.participants = [{ id: "p1", modelId: "openai/gpt-4.1", personaId: null }];
    state.positions = [];
    state.prefs = { defaultModelId: "openai/gpt-4.1", hasSeenIdeascapeHelp: true, webSearchEnabledByDefault: false };
    state.searchMode = { mode: "none", complexity: 1 };
    updateChat.mockResolvedValue({ activeBranchLeafApplied: true });
    advisorMocks.captureQueuedSnapshot.mockClear();
    advisorMocks.restoreQueuedSnapshot.mockClear();
    advisorMocks.completeSuccessfulSend.mockClear();
  });

  it("renders loading and empty message states", () => {
    state.isLoading = true;
    const { rerender } = render(<CanvasView chatId={chatId} />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();

    state.isLoading = false;
    rerender(<CanvasView chatId={chatId} />);
    expect(screen.getByText("no_messages_yet")).toBeInTheDocument();
  });

  it("persists node movement, handles help dismissal, and recovers rejected branch focus", async () => {
    const user = userEvent.setup();
    state.prefs = undefined;
    state.messages = [
      { _id: "msg_root", role: "user", content: "Root prompt", status: "completed", createdAt: 1 },
      { _id: "msg_child", role: "assistant", content: "Child answer", status: "completed", createdAt: 2, parentMessageIds: ["msg_root"] },
    ];
    state.positions = [{ messageId: "msg_root", x: 1, y: 2, width: 200, height: 120 }];
    updateChat.mockResolvedValueOnce({ activeBranchLeafApplied: false, activeBranchLeafId: "msg_child" });

    render(<CanvasView chatId={chatId} />);

    fireEvent.click(screen.getByTitle("how_ideascapes_work"));
    await waitFor(() => expect(screen.getByRole("button", { name: "dismiss-help" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "dismiss-help" }));
    expect(upsertPreferences).toHaveBeenCalledWith({ hasSeenIdeascapeHelp: true });

    await user.click(screen.getByRole("button", { name: "drag-root" }));
    expect(upsertPosition).toHaveBeenCalledWith(expect.objectContaining({ messageId: "msg_root", x: 20, y: 30, width: 200, height: 120 }));

    await user.click(screen.getByRole("button", { name: "resize-child" }));
    expect(upsertPosition).toHaveBeenCalledWith(expect.objectContaining({ messageId: "msg_child", x: 0, y: 0, width: 320, height: 180 }));

    await user.click(screen.getByRole("button", { name: "focus-root" }));
    await waitFor(() => expect(updateChat).toHaveBeenCalledWith(expect.objectContaining({
      activeBranchLeafId: "msg_child",
      activeBranchLeafExpectedCurrentId: null,
    })));
  });

  it("validates send state and routes paper-mode sends through the research action", async () => {
    const user = userEvent.setup();
    state.messages = [{ _id: "msg_root", role: "user", content: "Root prompt", status: "completed", createdAt: 1 }];
    state.participants = [
      { id: "p1", modelId: "openai/gpt-4.1", personaId: null },
      { id: "p2", modelId: "anthropic/claude", personaId: null },
    ];
    state.searchMode = { mode: "paper", complexity: 2 };

    const { rerender } = render(<CanvasView chatId={chatId} />);
    await user.click(screen.getByRole("button", { name: "focus-root" }));
    await user.click(screen.getByRole("button", { name: "send-from-canvas" }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));

    state.participants = [{ id: "p1", modelId: "openai/gpt-4.1", personaId: null }];
    rerender(<CanvasView chatId={chatId} />);
    await user.click(screen.getByRole("button", { name: "focus-root" }));
    await user.click(screen.getByRole("button", { name: "send-from-canvas" }));

    await waitFor(() => expect(startResearchPaper).toHaveBeenCalledWith(expect.objectContaining({
      chatId,
      text: "continue",
      complexity: 2,
      explicitParentIds: ["msg_root"],
    })));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(clearKBFiles).toHaveBeenCalled();
    expect(clearTurnOverrides).toHaveBeenCalled();
  });

  it("uses the queued Advisor snapshot instead of live Ideascape state", async () => {
    const user = userEvent.setup();
    state.messages = [{ _id: "msg_root", role: "user", content: "Root prompt", status: "completed", createdAt: 1 }];
    render(<CanvasView chatId={chatId} />);
    await user.click(screen.getByRole("button", { name: "focus-root" }));
    await user.click(screen.getByRole("button", { name: "send-queued-from-canvas" }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: "queued",
      advisorSelections: [{ personaId: "advisor_queued", allowWebSearch: false, keepAvailable: false }],
      advisorBrief: "queued brief",
    })));
    expect(advisorMocks.captureQueuedSnapshot).toHaveBeenCalledTimes(1);
    expect(advisorMocks.completeSuccessfulSend).not.toHaveBeenCalled();
  });
});
