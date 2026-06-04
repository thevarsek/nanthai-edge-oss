import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("preserves a caller-provided submit type", () => {
    const onSubmit = vi.fn();
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <IconButton label="Submit" type="submit">S</IconButton>
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("uses generated Tailwind classes for ghost and danger background states", () => {
    render(
      <div>
        <IconButton label="Ghost" variant="ghost">G</IconButton>
        <IconButton label="Danger" variant="danger">D</IconButton>
      </div>,
    );

    expect(screen.getByRole("button", { name: "Ghost" })).toHaveClass(
      "hover:bg-foreground/[0.08]",
      "active:bg-foreground/[0.12]",
    );
    expect(screen.getByRole("button", { name: "Danger" })).toHaveClass(
      "hover:bg-destructive/[0.10]",
      "active:bg-destructive/[0.15]",
    );
  });
});
