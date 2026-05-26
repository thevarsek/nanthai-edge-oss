import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MentionAutocompletePopover } from "./MentionAutocompletePopover";

describe("MentionAutocompletePopover", () => {
  it("does not intercept navigation keys when suggestions are empty", () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();

    render(
      <MentionAutocompletePopover
        suggestions={[]}
        onSelect={onSelect}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Enter" });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("selects the first suggestion with Enter", () => {
    const onSelect = vi.fn();

    render(
      <MentionAutocompletePopover
        suggestions={[
          {
            modelId: "openai/gpt-5",
            displayName: "GPT-5",
            subtitle: "OpenAI",
            isPersona: false,
          },
        ]}
        onSelect={onSelect}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.keyDown(document, { key: "Enter" });

    expect(screen.getByRole("button", { name: /GPT-5/i })).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ modelId: "openai/gpt-5" }));
  });

  it("clamps the active keyboard index when suggestions shrink", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <MentionAutocompletePopover
        suggestions={[
          {
            modelId: "openai/gpt-5",
            displayName: "GPT-5",
            subtitle: "OpenAI",
            isPersona: false,
          },
          {
            modelId: "anthropic/claude",
            displayName: "Claude",
            subtitle: "Anthropic",
            isPersona: false,
          },
        ]}
        onSelect={onSelect}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.keyDown(document, { key: "ArrowDown" });
    rerender(
      <MentionAutocompletePopover
        suggestions={[
          {
            modelId: "anthropic/claude",
            displayName: "Claude",
            subtitle: "Anthropic",
            isPersona: false,
          },
        ]}
        onSelect={onSelect}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ modelId: "anthropic/claude" }));
  });
});
