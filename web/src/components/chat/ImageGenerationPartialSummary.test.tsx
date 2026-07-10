import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImageGenerationPartialSummary } from "./ImageGenerationPartialSummary";

describe("ImageGenerationPartialSummary", () => {
  it("shows generated versus requested only for a partial result", () => {
    const { rerender } = render(
      <ImageGenerationPartialSummary result={{ requestedCount: 4, generatedCount: 3, failedCount: 1 }} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Generated 3 of 4 images.");

    rerender(
      <ImageGenerationPartialSummary result={{ requestedCount: 4, generatedCount: 4, failedCount: 0 }} />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
