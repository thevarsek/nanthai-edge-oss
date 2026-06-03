import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  test("has visible keyboard focus styling", () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toHaveClass(
      "focus-visible:ring-2",
      "focus-visible:ring-primary",
    );
  });

  test("uses generated Tailwind classes for the ghost variant background states", () => {
    render(<Button variant="ghost">Dismiss</Button>);

    expect(screen.getByRole("button", { name: "Dismiss" })).toHaveClass(
      "hover:bg-foreground/[0.08]",
      "active:bg-foreground/[0.12]",
    );
  });

  test("defaults to a non-submit button inside forms even when type is forwarded as undefined", () => {
    const onSubmit = vi.fn();
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Button type={undefined}>Cancel</Button>
      </form>,
    );

    const button = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(button);

    expect(button).toHaveAttribute("type", "button");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("preserves an explicit submit type", () => {
    const onSubmit = vi.fn();
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Button type="submit">Save</Button>
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
