import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MenuSelect } from "./MenuSelect";

describe("MenuSelect", () => {
  it("keeps the portal menu inside the viewport for long labels", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 180 });

    render(
      <MenuSelect
        value="long"
        options={[{ value: "long", label: "A very long option label that should truncate" }]}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: /A very long option label that should truncate/i,
    });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      width: 220,
      height: 32,
      top: 12,
      left: 0,
      right: 220,
      bottom: 44,
      x: 0,
      y: 12,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.click(trigger);

    await screen.findAllByRole("button", {
      name: /A very long option label that should truncate/i,
    });
    const option = screen.getAllByRole("button", {
      name: /A very long option label that should truncate/i,
    })[1]!;
    const menu = option.parentElement;

    await waitFor(() => expect(menu).toHaveStyle({ width: "164px", left: "8px" }));

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 120 });
    fireEvent.resize(window);

    await waitFor(() => expect(menu).toHaveStyle({ width: "104px", left: "8px" }));

    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
  });
});
