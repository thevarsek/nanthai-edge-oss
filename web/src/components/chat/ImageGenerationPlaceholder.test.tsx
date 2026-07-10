import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImageGenerationPlaceholder } from "./ImageGenerationPlaceholder";

describe("ImageGenerationPlaceholder", () => {
  it("renders the requested number of pending image tiles", () => {
    const { container } = render(<ImageGenerationPlaceholder count={4} />);

    expect(screen.getByRole("status")).toHaveAccessibleName("Generating 4 images...");
    expect(container.querySelectorAll("[aria-hidden='true'].aspect-square")).toHaveLength(4);
  });

  it("clamps future or malformed counts to the shared limit", () => {
    const { container } = render(<ImageGenerationPlaceholder compact count={99} />);

    expect(screen.getByRole("status")).toHaveAccessibleName("Generating 10 images...");
    expect(container.querySelectorAll("[aria-hidden='true'].aspect-square")).toHaveLength(10);
  });
});
