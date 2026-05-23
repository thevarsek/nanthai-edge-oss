import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchModePanel } from "./SearchModePanel";

describe("SearchModePanel", () => {
  it("normalizes invalid persisted complexity and renders safely", () => {
    render(
      <SearchModePanel
        current={{ mode: "web", complexity: 4 as 1 }}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        isPro
        isMultiModel={false}
      />,
    );

    expect(screen.getByText((_, element) => element?.textContent === "~$0.01 per message")).toBeInTheDocument();
  });

  it("keeps the panel open and shows an error when selection persistence fails", async () => {
    const onClose = vi.fn();
    render(
      <SearchModePanel
        current={{ mode: "none", complexity: 1 }}
        onSelect={vi.fn().mockRejectedValue(new Error("network"))}
        onClose={onClose}
        isPro
        isMultiModel={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to update search mode")).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
