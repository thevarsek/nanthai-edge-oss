import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatSearchBar } from "./ChatSearchBar";

describe("ChatSearchBar", () => {
  it("does not navigate with Enter when there are no matches", () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();

    render(
      <ChatSearchBar
        query="missing"
        onQueryChange={vi.fn()}
        matchCount={0}
        currentIndex={-1}
        onNext={onNext}
        onPrev={onPrev}
        onClose={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: true });

    expect(onNext).not.toHaveBeenCalled();
    expect(onPrev).not.toHaveBeenCalled();
  });
});
