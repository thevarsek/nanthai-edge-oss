import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Toggle } from "./Toggle";

describe("Toggle", () => {
  it("renders switch state and toggles by click", () => {
    const onChange = vi.fn();

    render(<Toggle checked={false} onChange={onChange} ariaLabel="Audio replies" />);

    const toggle = screen.getByRole("switch", { name: "Audio replies" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does not call onChange while disabled", () => {
    const onChange = vi.fn();

    render(<Toggle checked onChange={onChange} disabled ariaLabel="Disabled toggle" />);

    const toggle = screen.getByRole("switch", { name: "Disabled toggle" });
    expect(toggle).toBeDisabled();

    fireEvent.click(toggle);

    expect(onChange).not.toHaveBeenCalled();
  });
});
