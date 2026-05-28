import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the optional icon, description, action, and caller class", () => {
    render(
      <EmptyState
        icon={<span aria-label="empty-icon">Icon</span>}
        title="No memories yet"
        description="Saved memories will appear here."
        action={<button type="button">Create memory</button>}
        className="custom-empty"
      />,
    );

    expect(screen.getByLabelText("empty-icon")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No memories yet" })).toBeInTheDocument();
    expect(screen.getByText("Saved memories will appear here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create memory" })).toBeInTheDocument();
    expect(screen.getByText("No memories yet").closest(".custom-empty")).toBeInTheDocument();
  });
});
