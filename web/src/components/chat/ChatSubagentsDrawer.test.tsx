import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatSubagentsDrawer } from "./ChatSubagentsDrawer";

describe("ChatSubagentsDrawer", () => {
  it("exposes dialog and radio semantics for the subagent override picker", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <ChatSubagentsDrawer
        selectedOverride="inherit"
        isEffectivelyEnabled={false}
        isPro={false}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("dialog", { name: /subagents/i })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /subagents/i })).toBeInTheDocument();

    const inherit = screen.getByRole("radio", { name: /use chat defaults/i });
    const enabled = screen.getByRole("radio", { name: /always on in this chat/i });
    const disabled = screen.getByRole("radio", { name: /always off in this chat/i });

    expect(inherit).toHaveAttribute("aria-checked", "true");
    expect(enabled).toHaveAttribute("aria-checked", "false");
    expect(enabled).toHaveAttribute("aria-disabled", "true");
    expect(disabled).toHaveAttribute("aria-checked", "false");

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    inherit.focus();
    await user.keyboard("{ArrowDown}");
    expect(disabled).toHaveFocus();

    await user.click(disabled);
    expect(onSelect).toHaveBeenCalledWith("disabled");
    expect(onClose).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
