import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReasoningBlock } from "./ReasoningBlock";

describe("ReasoningBlock", () => {
  it("announces expanded state and controls the reasoning panel", () => {
    render(<ReasoningBlock reasoning="A short chain of thought summary." />);

    const toggle = screen.getByRole("button", { name: "Reasoning" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const panelId = toggle.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(panelId!)).toBeInTheDocument();
  });

  it("uses unique controlled panel ids when multiple blocks render", () => {
    render(
      <>
        <ReasoningBlock reasoning="First reasoning summary." />
        <ReasoningBlock reasoning="Second reasoning summary." />
      </>,
    );

    const ids = screen
      .getAllByRole("button", { name: "Reasoning" })
      .map((button) => button.getAttribute("aria-controls"));

    expect(new Set(ids).size).toBe(2);
  });
});
