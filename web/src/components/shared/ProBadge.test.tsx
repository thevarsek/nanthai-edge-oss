import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProBadge } from "./ProBadge";

describe("ProBadge", () => {
  it("renders compact and custom class variants used by gated routes", () => {
    const { rerender } = render(<ProBadge size="sm" className="settings-pill" />);

    expect(screen.getByText("Pro")).toHaveClass("text-[10px]", "settings-pill");

    rerender(<ProBadge />);
    expect(screen.getByText("Pro")).toHaveClass("text-xs");
  });
});
