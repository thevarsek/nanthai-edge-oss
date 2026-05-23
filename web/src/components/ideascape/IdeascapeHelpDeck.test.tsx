import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IdeascapeHelpDeck } from "./IdeascapeHelpDeck";

describe("IdeascapeHelpDeck", () => {
  it("names the dismiss button for assistive technology", () => {
    const onDismiss = vi.fn();

    render(<IdeascapeHelpDeck onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: /dismiss ideascape help/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
