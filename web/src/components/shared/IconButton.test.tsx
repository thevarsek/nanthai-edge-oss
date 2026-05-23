import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("exposes focus-visible styling and distinct size classes", () => {
    render(
      <div>
        <IconButton label="Small" size="sm">S</IconButton>
        <IconButton label="Medium" size="md">M</IconButton>
        <IconButton label="Large" size="lg">L</IconButton>
      </div>,
    );

    expect(screen.getByRole("button", { name: "Small" })).toHaveClass("h-10", "w-10");
    expect(screen.getByRole("button", { name: "Medium" })).toHaveClass("h-11", "w-11");
    expect(screen.getByRole("button", { name: "Large" })).toHaveClass("h-12", "w-12");
    expect(screen.getByRole("button", { name: "Small" }).className).toContain("focus-visible:ring-2");
  });
});
