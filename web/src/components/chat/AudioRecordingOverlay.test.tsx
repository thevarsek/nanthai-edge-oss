import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AudioRecordingOverlay } from "./AudioRecordingOverlay";

describe("AudioRecordingOverlay", () => {
  it("exposes the primary recording action as stop recording", () => {
    const onStop = vi.fn();
    render(
      <AudioRecordingOverlay
        elapsedMs={3_000}
        levels={[0.2, 0.4, 0.8]}
        interimTranscript=""
        onStop={onStop}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));

    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
