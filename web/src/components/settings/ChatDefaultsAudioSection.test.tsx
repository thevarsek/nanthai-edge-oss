import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatDefaultsAudioSection } from "./ChatDefaultsAudioSection";

const state = vi.hoisted(() => ({
  previewVoice: vi.fn(async () => ({ audioBase64: "ZmFrZQ==", mimeType: "audio/mpeg" })),
  models: [{
    modelId: "microsoft/mai-voice-2",
    name: "MAI Voice 2",
    mediaCapabilities: {
      speech: {
        voices: ["en-US-Aria:DragonHDLatestNeural"],
        outputFormats: ["mp3", "pcm"],
        supportsSpeed: true,
        speedMin: 0.5,
        speedMax: 2,
        supportsInstructions: false,
        supportsStyle: true,
        styleDegreeMin: 0.01,
        styleDegreeMax: 2,
      },
    },
  }],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("convex/react", () => ({ useAction: () => state.previewVoice }));
vi.mock("@/hooks/useSharedData", () => ({ useModelSummaries: () => state.models }));
vi.mock("./ChatDefaultsMediaModelPickerRow", () => ({
  ChatDefaultsMediaModelPickerRow: ({ label }: { label: string }) => <div>{label}</div>,
}));
vi.mock("@/components/shared/MenuSelect", () => ({
  MenuSelect: ({ value, options, onChange, ariaLabel, disabled }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
    ariaLabel?: string;
    disabled?: boolean;
  }) => (
    <select aria-label={ariaLabel} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));
vi.mock("@/components/shared/SegmentedControl", () => ({
  SegmentedControl: () => <div>playback-control</div>,
}));
vi.mock("@/components/shared/Toggle", () => ({
  Toggle: () => <div>toggle</div>,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  state.previewVoice.mockClear();
  state.models[0].mediaCapabilities.speech.voices = ["en-US-Aria:DragonHDLatestNeural"];
});

describe("ChatDefaultsAudioSection", () => {
  it("uses model voices and enables only the selected model's TTS controls", async () => {
    const onChange = vi.fn();
    const onBufferedChange = vi.fn();
    class FakeAudio {
      src = "";
      pause = vi.fn();
      play = vi.fn(async () => undefined);
      addEventListener = vi.fn();
      constructor(src: string) { this.src = src; }
    }
    vi.stubGlobal("Audio", FakeAudio);

    render(<ChatDefaultsAudioSection prefs={{
      defaultSpeechGenerationModelId: "microsoft/mai-voice-2",
      preferredVoice: "nova",
      defaultSpeechOutputFormat: "mp3",
    }} onChange={onChange} onBufferedChange={onBufferedChange} />);

    const voice = screen.getByRole("combobox", { name: "voice" });
    expect(voice).toHaveValue("en-US-Aria:DragonHDLatestNeural");
    expect(screen.getByText("speech_voice_unavailable")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "speech_instructions" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "speech_style" })).toBeEnabled();

    const speed = screen.getByRole("spinbutton", { name: "speech_synthesis_speed" });
    expect(speed).toHaveAttribute("min", "0.5");
    expect(speed).toHaveAttribute("max", "2");
    fireEvent.change(speed, { target: { value: "1.25" } });
    fireEvent.blur(speed);
    expect(onBufferedChange).toHaveBeenCalledWith({ defaultSpeechSpeed: 1.25 });

    const style = screen.getByRole("textbox", { name: "speech_style" });
    fireEvent.change(style, { target: { value: " calm " } });
    expect(onBufferedChange).toHaveBeenCalledWith({ defaultSpeechStyle: "calm" });
    fireEvent.blur(style);
    expect(style).toHaveValue("calm");

    fireEvent.click(screen.getByText("audio_preview_voice"));
    await waitFor(() => expect(state.previewVoice).toHaveBeenCalledWith({
      voice: "en-US-Aria:DragonHDLatestNeural",
    }));
  });

  it("accepts a custom provider voice ID when the model publishes no voice list", () => {
    state.models[0].mediaCapabilities.speech.voices = [];
    const onBufferedChange = vi.fn();

    render(<ChatDefaultsAudioSection prefs={{
      defaultSpeechGenerationModelId: "microsoft/mai-voice-2",
      preferredVoice: "custom-voice-1",
    }} onChange={vi.fn()} onBufferedChange={onBufferedChange} />);

    const voice = screen.getByRole("textbox", { name: "voice" });
    expect(voice).toHaveValue("custom-voice-1");
    expect(screen.getByText("speech_custom_voice_hint")).toBeInTheDocument();
    fireEvent.change(voice, { target: { value: " custom-voice-2 " } });
    fireEvent.blur(voice);
    expect(onBufferedChange).toHaveBeenCalledWith({ preferredVoice: "custom-voice-2" });
  });

  it("requires a custom provider voice before preview when no list is published", () => {
    state.models[0].mediaCapabilities.speech.voices = [];

    render(<ChatDefaultsAudioSection prefs={{
      defaultSpeechGenerationModelId: "microsoft/mai-voice-2",
    }} onChange={vi.fn()} onBufferedChange={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "voice" })).toBeRequired();
    expect(screen.getByRole("button", { name: /audio_preview_voice/ })).toBeDisabled();
  });
});
