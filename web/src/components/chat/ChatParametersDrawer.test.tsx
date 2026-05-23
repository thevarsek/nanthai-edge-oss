import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ChatParametersDrawer,
  type ChatParameterOverrides,
} from "./ChatParametersDrawer";

const baseOverrides: ChatParameterOverrides = {
  temperatureMode: "default",
  temperature: 0.7,
  maxTokensMode: "default",
  maxTokens: undefined,
  reasoningMode: "default",
  reasoningEffort: "medium",
  autoAudioResponseMode: "default",
};

const defaults = {
  temperature: 0.7,
  maxTokens: undefined,
  includeReasoning: true,
  reasoningEffort: "medium",
  autoAudioResponse: false,
};

describe("ChatParametersDrawer", () => {
  it("does not expose reasoning effort controls until reasoning is explicitly on", () => {
    const onChange = vi.fn();
    render(
      <ChatParametersDrawer
        overrides={baseOverrides}
        defaults={defaults}
        onChange={onChange}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Reasoning Effort")).toHaveLength(1);

    fireEvent.click(screen.getAllByRole("radio", { name: "Always On" })[0]!);

    expect(screen.getAllByText("Reasoning Effort")).toHaveLength(2);
    expect(onChange).toHaveBeenLastCalledWith({
      ...baseOverrides,
      reasoningMode: "on",
    });
  });

  it("resyncs max token text when override props change", () => {
    const { rerender } = render(
      <ChatParametersDrawer
        overrides={{
          ...baseOverrides,
          maxTokensMode: "override",
          maxTokens: 1024,
        }}
        defaults={defaults}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox")).toHaveValue("1024");

    rerender(
      <ChatParametersDrawer
        overrides={{
          ...baseOverrides,
          maxTokensMode: "override",
          maxTokens: 4096,
        }}
        defaults={defaults}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox")).toHaveValue("4096");
  });
});
