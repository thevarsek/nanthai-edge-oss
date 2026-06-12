import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatDefaultsSection } from "./ChatDefaultsSection";

const state = vi.hoisted(() => {
  const makePrefs = () => ({
    defaultModelId: "openai/gpt-4.1",
    defaultPersonaId: null as string | null,
    titleModelId: "anthropic/claude-sonnet-4.5",
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096,
    includeReasoning: true,
    reasoningEffort: "medium",
    autoAudioResponse: false,
    preferredVoice: "nova",
    defaultAudioSpeed: 1,
    webSearchEnabledByDefault: true,
    defaultSearchMode: "basic",
    defaultSearchComplexity: 1,
    subagentsEnabledByDefault: false,
    defaultVideoAspectRatio: "16:9",
    defaultVideoDuration: 5,
    defaultVideoResolution: "720p",
    defaultVideoGenerateAudio: true,
    zdrEnabled: false,
    sendOnEnter: true,
  });
  return {
    makePrefs,
    prefs: makePrefs(),
    personas: [
      { _id: "persona_1", displayName: "Researcher", avatarEmoji: "R", modelId: "google/gemini-2.5-pro" },
    ],
    models: [
      { modelId: "openai/gpt-4.1", name: "GPT 4.1" },
      { modelId: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet" },
      { modelId: "google/gemini-2.5-pro", name: "Gemini Pro" },
    ],
    isPro: true,
    updatePreference: vi.fn(),
    updatePreferenceImmediate: vi.fn(),
    previewVoice: vi.fn(async () => ({ audioBase64: "ZmFrZQ==", mimeType: "audio/wav" })),
    captureSettingChanged: vi.fn(),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (typeof options?.var1 === "string" || typeof options?.var1 === "number") return `${key}:${options.var1}`;
      return key;
    },
  }),
}));

vi.mock("convex/react", () => ({
  useAction: () => state.previewVoice,
}));

vi.mock("@/hooks/useSharedData", () => ({
  useSharedData: () => ({ prefs: state.prefs, personas: state.personas }),
  useModelSummaries: () => state.models,
}));

vi.mock("@/hooks/usePreferenceBuffer", () => ({
  usePreferenceBuffer: (options?: { onPersistedPatch?: (patch: Record<string, unknown>) => void }) => ({
    updatePreference: (patch: Record<string, unknown>) => {
      state.updatePreference(patch);
      options?.onPersistedPatch?.(patch);
    },
    updatePreferenceImmediate: (patch: Record<string, unknown>) => {
      state.updatePreferenceImmediate(patch);
      options?.onPersistedPatch?.(patch);
    },
  }),
}));

vi.mock("@/hooks/useProGate.hook", () => ({
  useProGate: () => ({ isPro: state.isPro }),
}));

vi.mock("@/components/shared/PersonaAvatar", () => ({
  PersonaAvatar: ({ personaName }: { personaName?: string }) => <span>avatar-{personaName}</span>,
}));

vi.mock("@/components/shared/ProviderLogo", () => ({
  ProviderLogo: ({ modelId }: { modelId: string }) => <span>logo-{modelId || "empty"}</span>,
}));

vi.mock("@/components/shared/ModelPicker", () => ({
  ModelPicker: ({ selectedModelId, onSelect, onClose }: {
    selectedModelId: string;
    onSelect: (modelId: string) => void;
    onClose: () => void;
  }) => (
    <div data-testid="model-picker">
      <span>{selectedModelId}</span>
      <button onClick={() => onSelect("google/gemini-2.5-pro")}>pick-title-model</button>
      <button onClick={onClose}>close-title-model</button>
    </div>
  ),
}));

vi.mock("./ChatDefaultsSection.ParticipantPicker", () => ({
  ParticipantPicker: ({ selectedModelId, selectedPersonaId, onSelectModel, onSelectPersona, onClose }: {
    selectedModelId: string;
    selectedPersonaId: string | null;
    onSelectModel: (modelId: string) => void;
    onSelectPersona: (personaId: string) => void;
    onClose: () => void;
  }) => (
    <div data-testid="participant-picker">
      <span>{selectedModelId}</span>
      <span>{selectedPersonaId ?? "none"}</span>
      <button onClick={() => onSelectModel("anthropic/claude-sonnet-4.5")}>pick-default-model</button>
      <button onClick={() => onSelectPersona("persona_1")}>pick-default-persona</button>
      <button onClick={onClose}>close-participant</button>
    </div>
  ),
}));

vi.mock("@/components/shared/MenuSelect", () => ({
  MenuSelect: ({ value, options, onChange }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
  }) => (
    <select aria-label={`select-${value}`} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

vi.mock("@/components/shared/SegmentedControl", () => ({
  SegmentedControl: ({ value, options, onChange }: {
    value: string | number | boolean;
    options: Array<{ value: string | number | boolean; label: string }>;
    onChange: (value: never) => void;
  }) => (
    <div data-testid={`segments-${String(value)}`}>
      {options.map((option) => (
        <button key={String(option.value)} onClick={() => onChange(option.value as never)}>
          segment-{option.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/components/shared/Toggle", () => ({
  Toggle: ({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      {checked ? "on" : "off"}
    </button>
  ),
}));

vi.mock("@/components/shared/PaywallModal", () => ({
  PaywallModal: ({ feature, onClose }: { feature: string; onClose: () => void }) => (
    <div role="dialog" aria-label="paywall">
      <span>{feature}</span>
      <button onClick={onClose}>close-paywall</button>
    </div>
  ),
}));

vi.mock("@/components/shared/ProBadge", () => ({
  ProBadge: () => <span>pro-badge</span>,
}));

vi.mock("@/lib/featureAnalytics", () => ({
  captureSettingChanged: state.captureSettingChanged,
}));

function renderSection() {
  return render(
    <MemoryRouter>
      <ChatDefaultsSection />
    </MemoryRouter>,
  );
}

function settingRow(label: string | RegExp) {
  const labelNode = screen.getByText(label);
  let row = labelNode.parentElement;
  while (row) {
    if (within(row).queryByRole("switch")) return row;
    row = row.parentElement;
  }
  throw new Error(`Missing setting row for ${String(label)}`);
}

function settingSwitch(label: string | RegExp) {
  return within(settingRow(label)).getByRole("switch");
}

beforeEach(() => {
  state.prefs = state.makePrefs();
  state.isPro = true;
  state.updatePreference.mockReset();
  state.updatePreferenceImmediate.mockReset();
  state.previewVoice.mockReset();
  state.captureSettingChanged.mockReset();
  state.previewVoice.mockResolvedValue({ audioBase64: "ZmFrZQ==", mimeType: "audio/wav" });
  class FakeAudio {
    src = "";
    pause = vi.fn();
    play = vi.fn(async () => undefined);
    constructor(src: string) { this.src = src; }
    addEventListener = vi.fn();
  }
  vi.stubGlobal("Audio", FakeAudio);
});

describe("ChatDefaultsSection", () => {
  it("opens participant and title model pickers and writes immediate preference payloads", () => {
    renderSection();

    fireEvent.click(screen.getByText("GPT 4.1"));
    expect(screen.getByTestId("participant-picker")).toHaveTextContent("openai/gpt-4.1");
    fireEvent.click(screen.getByText("pick-default-model"));
    expect(state.updatePreferenceImmediate).toHaveBeenCalledWith({
      defaultModelId: "anthropic/claude-sonnet-4.5",
    });

    fireEvent.click(screen.getByText("pick-default-persona"));
    expect(state.updatePreferenceImmediate).toHaveBeenCalledWith({
      defaultModelId: "google/gemini-2.5-pro",
      defaultPersonaId: "persona_1",
    });

    fireEvent.click(screen.getByText("Claude Sonnet"));
    fireEvent.click(screen.getByText("pick-title-model"));
    expect(state.updatePreferenceImmediate).toHaveBeenCalledWith({ titleModelId: "google/gemini-2.5-pro" });
    expect(screen.queryByTestId("model-picker")).not.toBeInTheDocument();
  });

  it("autosaves generation, search, audio, video, privacy, and behavior controls", () => {
    renderSection();

    fireEvent.change(screen.getByDisplayValue("4096"), { target: { value: "8192 tokens" } });
    expect(state.updatePreference).toHaveBeenCalledWith({ defaultMaxTokens: 8192 });

    fireEvent.change(screen.getByDisplayValue("0.7"), { target: { value: "1.2" } });
    expect(state.updatePreference).toHaveBeenCalledWith({ defaultTemperature: 1.2 });

    fireEvent.change(screen.getByLabelText("select-medium"), { target: { value: "high" } });
    expect(state.updatePreferenceImmediate).toHaveBeenCalledWith({ reasoningEffort: "high" });

    fireEvent.click(screen.getByText("segment-1.5x"));
    expect(state.updatePreferenceImmediate).toHaveBeenCalledWith({ defaultAudioSpeed: 1.5 });

    fireEvent.click(screen.getByText("segment-9:16"));
    expect(state.updatePreferenceImmediate).toHaveBeenCalledWith({ defaultVideoAspectRatio: "9:16" });
    fireEvent.click(screen.getByText("segment-1080p"));
    expect(state.updatePreferenceImmediate).toHaveBeenCalledWith({ defaultVideoResolution: "1080p" });
    fireEvent.click(screen.getByText("segment-10s"));
    expect(state.updatePreferenceImmediate).toHaveBeenCalledWith({ defaultVideoDuration: 10 });

    fireEvent.click(settingSwitch("include_reasoning"));
    expect(state.updatePreferenceImmediate).toHaveBeenCalledWith({ includeReasoning: false });
    fireEvent.click(settingSwitch("audio_auto_reply"));
    expect(state.updatePreferenceImmediate).toHaveBeenCalledWith({ autoAudioResponse: true });
    fireEvent.click(settingSwitch("video_config_audio"));
    expect(state.updatePreferenceImmediate).toHaveBeenCalledWith({ defaultVideoGenerateAudio: false });
    fireEvent.click(settingSwitch("zdr_toggle_label"));
    expect(state.updatePreferenceImmediate).toHaveBeenCalledWith({ zdrEnabled: true });
    fireEvent.click(settingSwitch("send_on_enter"));
    expect(state.updatePreferenceImmediate).toHaveBeenCalledWith({ sendOnEnter: false });
  });

  it("captures debounced generation settings only after the persisted patch changes", () => {
    renderSection();

    const temperatureInput = screen.getByDisplayValue("0.7");
    fireEvent.blur(temperatureInput);
    expect(state.captureSettingChanged).not.toHaveBeenCalledWith(expect.objectContaining({
      setting_key: "defaultTemperature",
    }));

    fireEvent.change(temperatureInput, { target: { value: "1.1" } });
    expect(state.captureSettingChanged).toHaveBeenCalledWith({
      setting_key: "defaultTemperature",
      setting_area: "chat",
      value_type: "number",
    });
  });

  it("gates advanced search and subagents for free users but saves them for pro users", () => {
    state.isPro = false;
    renderSection();

    fireEvent.change(screen.getByLabelText("select-basic"), { target: { value: "web" } });
    expect(screen.getByRole("dialog", { name: "paywall" })).toHaveTextContent("Advanced Search");
    expect(state.updatePreferenceImmediate).not.toHaveBeenCalledWith({ defaultSearchMode: "web" });
    fireEvent.click(screen.getByText("close-paywall"));

    fireEvent.click(settingSwitch("subagents"));
    expect(screen.getByRole("dialog", { name: "paywall" })).toHaveTextContent("Subagents");
    expect(state.updatePreferenceImmediate).not.toHaveBeenCalledWith({ subagentsEnabledByDefault: true });
  });

  it("saves pro search tiers and starts voice preview playback", async () => {
    state.prefs.defaultSearchMode = "web";
    state.prefs.defaultSearchComplexity = 2;
    const { unmount } = renderSection();

    fireEvent.change(screen.getByLabelText("select-web"), { target: { value: "paper" } });
    expect(state.updatePreferenceImmediate).toHaveBeenCalledWith({ defaultSearchMode: "paper" });
    fireEvent.click(screen.getByText("segment-comprehensive"));
    expect(state.updatePreferenceImmediate).toHaveBeenCalledWith({ defaultSearchComplexity: 3 });

    fireEvent.change(screen.getByLabelText("select-nova"), { target: { value: "echo" } });
    expect(state.updatePreferenceImmediate).toHaveBeenCalledWith({ preferredVoice: "echo" });
    fireEvent.click(screen.getByText("audio_preview_voice"));
    await waitFor(() => expect(state.previewVoice).toHaveBeenCalledWith({ voice: "echo" }));
    expect(await screen.findByText("audio_stop_preview")).toBeInTheDocument();

    unmount();
  });

});
