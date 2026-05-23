import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandWordmark } from "./BrandWordmark";

describe("BrandWordmark", () => {
  it("keeps the monogram decorative while exposing the text wordmark", () => {
    const { container } = render(<BrandWordmark />);

    expect(screen.getByText("NanthAi")).toBeInTheDocument();
    const image = container.querySelector("img");
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img", { name: /nanthai edge logo/i })).not.toBeInTheDocument();
  });
});
