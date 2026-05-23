import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BalanceIndicator } from "./BalanceIndicator";

describe("BalanceIndicator", () => {
  it("hides missing balances", () => {
    const { container } = render(<BalanceIndicator balance={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("formats and colors known balances", () => {
    render(<BalanceIndicator balance={1.5} />);

    expect(screen.getByText("$1.50")).toHaveClass("text-amber-400");
  });
});
