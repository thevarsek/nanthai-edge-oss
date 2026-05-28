import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatHeader, ChatModalPanels, type ChatModalPanelsProps, EmptyChatState } from "./ChatPage.header";
import type { SearchModeState } from "@/components/chat/SearchModePanel";

const modelSummaries = vi.hoisted(() => ({
  value: [
    { modelId: "openai/gpt-4.1", name: "GPT 4.1" },
    { modelId: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet" },
  ],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (typeof options?.var1 === "number") return `${options.var1} models`;
      return key;
    },
  }),
}));

vi.mock("@/hooks/useSharedData", () => ({
  useModelSummaries: () => modelSummaries.value,
}));

vi.mock("@/components/chat/SearchModePanel", () => ({
  SearchModePanel: ({ current, onSelect, onClose, isPro, isMultiModel }: {
    current: SearchModeState;
    onSelect: (state: SearchModeState) => void;
    onClose: () => void;
    isPro: boolean;
    isMultiModel: boolean;
  }) => (
    <div data-testid="search-panel">
      <span>{current.mode}</span>
      <span>{isPro ? "pro" : "free"}</span>
      <span>{isMultiModel ? "multi" : "single"}</span>
      <button onClick={() => onSelect({ mode: "web", complexity: 3 })}>set-web</button>
      <button onClick={onClose}>close-search</button>
    </div>
  ),
}));

vi.mock("@/components/chat/ChatParametersDrawer", () => ({
  ChatParametersDrawer: ({ onChange, onClose }: { onChange: (value: unknown) => void; onClose: () => void }) => (
    <button onClick={() => { onChange({ temperature: 0.3 }); onClose(); }}>parameters-panel</button>
  ),
}));
vi.mock("@/components/chat/ChatIntegrationsPicker", () => ({
  ChatIntegrationsPicker: ({ onToggle, onClose }: { onToggle: (key: "gmail") => void; onClose: () => void }) => (
    <button onClick={() => { onToggle("gmail"); onClose(); }}>integrations-panel</button>
  ),
}));
vi.mock("@/components/chat/ChatSkillsPicker", () => ({
  ChatSkillsPicker: ({ onCycleSkill, onClose }: { onCycleSkill: (id: string) => void; onClose: () => void }) => (
    <button onClick={() => { onCycleSkill("skill_1"); onClose(); }}>skills-panel</button>
  ),
}));
vi.mock("@/components/chat/ChatKBPicker", () => ({
  ChatKBPicker: ({ onToggle, onClose }: { onToggle: (id: string) => void; onClose: () => void }) => (
    <button onClick={() => { onToggle("file_1"); onClose(); }}>kb-panel</button>
  ),
}));
vi.mock("@/components/chat/ChatParticipantPicker", () => ({
  ChatParticipantPicker: ({ chatId, onAdd, onRemove, onSetParticipants, onClose }: {
    chatId: string;
    onAdd: (args: unknown) => Promise<unknown>;
    onRemove: (id: string) => Promise<void>;
    onSetParticipants: (chatId: string, entries: unknown[]) => Promise<void>;
    onClose: () => void;
  }) => (
    <button onClick={() => {
      void onAdd({ chatId, modelId: "openai/gpt-4.1" });
      void onRemove("participant_1");
      void onSetParticipants(chatId, []);
      onClose();
    }}>participants-panel</button>
  ),
}));
vi.mock("@/components/chat/ChatSubagentsDrawer", () => ({
  ChatSubagentsDrawer: ({ onSelect, onClose }: { onSelect: (value: string) => void; onClose: () => void }) => (
    <button onClick={() => { onSelect("enabled"); onClose(); }}>subagents-panel</button>
  ),
}));
vi.mock("@/components/chat/AutonomousSettingsDrawer", () => ({
  AutonomousSettingsDrawer: ({ onChange, onStart, onClose }: {
    onChange: (value: unknown) => void;
    onStart: () => void;
    onClose: () => void;
  }) => (
    <button onClick={() => { onChange({ maxTurns: 5 }); onStart(); onClose(); }}>autonomous-panel</button>
  ),
}));

describe("ChatHeader", () => {
  it("renders title fallback, model subtitles, search mode selection, and pro ideascape action", () => {
    const onBack = vi.fn();
    const onRename = vi.fn();
    const onSetSearchMode = vi.fn();
    const onToggleIdeascape = vi.fn();

    render(
      <ChatHeader
        title=""
        onBack={onBack}
        participants={[{ modelId: "openai/gpt-4.1" } as never]}
        onRename={onRename}
        searchMode={{ mode: "web", complexity: 2 }}
        globeColor="blue"
        onSetSearchMode={onSetSearchMode}
        isPro
        isMultiModel
        onToggleIdeascape={onToggleIdeascape}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "new_chat" }));
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.getByText("GPT 4.1")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Search: web — click for options"));
    expect(screen.getByTestId("search-panel")).toHaveTextContent("pro");
    expect(screen.getByTestId("search-panel")).toHaveTextContent("multi");
    fireEvent.click(screen.getByText("set-web"));
    expect(onSetSearchMode).toHaveBeenCalledWith({ mode: "web", complexity: 3 });

    fireEvent.click(screen.getByTitle("switch_to_ideascape_title"));
    expect(onToggleIdeascape).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole("button")[0]!);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("toggles detailed cost breakdown and hides pro-only ideascape control for free users", () => {
    render(
      <ChatHeader
        title="Budget chat"
        onBack={vi.fn()}
        participants={[
          { modelId: "openai/gpt-4.1" } as never,
          { modelId: "anthropic/claude-sonnet-4.5" } as never,
        ]}
        searchMode={{ mode: "none", complexity: 1 }}
        globeColor="muted"
        onSetSearchMode={vi.fn()}
        isPro={false}
        totalCost={0.0123}
        showAdvancedStats
        breakdown={{ responses: 0.01, memory: 0.001, search: 0.001, other: 0.0003 }}
      />,
    );

    expect(screen.queryByTitle("switch_to_ideascape_title")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("tap_to_see_cost_breakdown"));
    expect(screen.getByText("cost_breakdown_responses")).toBeInTheDocument();
    expect(screen.getByText("cost_breakdown_memory")).toBeInTheDocument();
    expect(screen.getByText("cost_breakdown_search")).toBeInTheDocument();
    expect(screen.getByText("cost_breakdown_other")).toBeInTheDocument();
    fireEvent.click(document.querySelector(".fixed.inset-0.z-40")!);
    expect(screen.queryByText("cost_breakdown_responses")).not.toBeInTheDocument();
  });

  it("renders the empty state copy", () => {
    render(<EmptyChatState />);
    expect(screen.getByText("no_messages")).toBeInTheDocument();
    expect(screen.getByText("type_a_message_to_get_started")).toBeInTheDocument();
  });
});

describe("ChatModalPanels", () => {
  function props(activePanel: ChatModalPanelsProps["activePanel"]): ChatModalPanelsProps {
    return {
      activePanel,
      closePanel: vi.fn(),
      paramOverrides: {
        temperatureMode: "default",
        temperature: 0.7,
        maxTokensMode: "default",
        maxTokens: undefined,
        reasoningMode: "default",
        reasoningEffort: "medium",
        autoAudioResponseMode: "default",
      },
      setParamOverrides: vi.fn(),
      paramDefaults: { temperature: 0.7, maxTokens: undefined, includeReasoning: false, reasoningEffort: "medium", autoAudioResponse: false },
      enabledIntegrations: new Set(),
      toggleIntegration: vi.fn(),
      connectedProviders: { gmail: true, google: false, microsoft: false, apple: false, notion: false, cloze: false, slack: false },
      enabledSkillIds: new Set(),
      toggleSkill: vi.fn(),
      skillOverrides: new Map(),
      cycleSkill: vi.fn(),
      selectedKBFileIds: new Set(),
      toggleKBFile: vi.fn(),
      chatId: "chat_1" as never,
      convexParticipants: [],
      addParticipant: vi.fn(async () => null),
      removeParticipant: vi.fn(async () => undefined),
      setParticipants: vi.fn(async () => undefined),
      subagentOverride: "inherit",
      effectiveSubagentsEnabled: false,
      isPro: true,
      handleSubagentOverrideChange: vi.fn(),
      autonomousSettings: { maxCycles: 3, pauseBetweenTurns: 1, autoStopOnConsensus: false, moderatorParticipantId: null },
      onAutonomousSettingsChange: vi.fn(),
      participants: [],
      hasMessages: true,
      onAutonomousStart: vi.fn(),
    };
  }

  it.each([
    ["parameters", "parameters-panel"],
    ["integrations", "integrations-panel"],
    ["skills", "skills-panel"],
    ["knowledgeBase", "kb-panel"],
    ["participants", "participants-panel"],
    ["subagents", "subagents-panel"],
    ["autonomous", "autonomous-panel"],
  ] as const)("renders and wires the %s panel", (activePanel, label) => {
    const p = props(activePanel);
    render(<ChatModalPanels {...p} />);
    fireEvent.click(screen.getByText(label));
    expect(p.closePanel).toHaveBeenCalledTimes(1);
  });

  it("does not render participant picker without a chat id", () => {
    const p = props("participants");
    p.chatId = undefined;
    const { container } = render(<ChatModalPanels {...p} />);
    expect(container).toBeEmptyDOMElement();
  });
});
