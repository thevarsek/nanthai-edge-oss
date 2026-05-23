import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AutonomousSettingsDrawer } from "./AutonomousSettingsDrawer";
import type { AutonomousSettings } from "@/hooks/useAutonomous";

const settings: AutonomousSettings = {
  maxCycles: 2,
  pauseBetweenTurns: 1,
  autoStopOnConsensus: true,
  moderatorParticipantId: null,
};

const participants = [
  { modelId: "openai/gpt-4o", personaName: "One" },
  { modelId: "anthropic/claude", personaName: "Two" },
  { modelId: "google/gemini", personaName: "Three" },
];

describe("AutonomousSettingsDrawer", () => {
  it("requires an existing message before starting", () => {
    render(
      <AutonomousSettingsDrawer
        settings={settings}
        onChange={vi.fn()}
        participants={participants as never}
        hasMessages={false}
        onStart={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /start discussion/i })).toBeDisabled();
    expect(screen.getByText(/send at least one message/i)).toBeInTheDocument();
  });

  it("updates moderator selection and closes after starting", () => {
    const onChange = vi.fn();
    const onStart = vi.fn();
    const onClose = vi.fn();

    render(
      <AutonomousSettingsDrawer
        settings={settings}
        onChange={onChange}
        participants={participants as never}
        hasMessages
        onStart={onStart}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText("One"));
    expect(onChange).toHaveBeenCalledWith({ ...settings, moderatorParticipantId: "0" });

    fireEvent.click(screen.getByRole("button", { name: /start discussion/i }));
    expect(onStart).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
