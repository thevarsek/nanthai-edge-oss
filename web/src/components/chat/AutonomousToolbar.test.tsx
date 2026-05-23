import { fireEvent, render, screen } from "@testing-library/react";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { AutonomousToolbar } from "./AutonomousToolbar";

describe("AutonomousToolbar", () => {
  it("does not submit an enclosing form from toolbar actions", () => {
    const onPause = vi.fn();
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <AutonomousToolbar
          state={{ status: "active", cycle: 1, maxCycles: 3, currentParticipant: "Claude" }}
          onPause={onPause}
          onResume={vi.fn()}
          onStop={vi.fn()}
          onDismiss={vi.fn()}
        />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: /pause/i }));

    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
