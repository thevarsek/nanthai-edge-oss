import type { FormEvent } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { NavRow, SettingsRow } from "./SettingsHelpers";

describe("SettingsHelpers", () => {
  it("does not submit an enclosing form for clickable settings rows", () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const onNav = vi.fn();
    const onRow = vi.fn();

    render(
      <MemoryRouter>
        <form onSubmit={onSubmit}>
          <NavRow label="Open profile" onClick={onNav} />
          <SettingsRow onClick={onRow}>
            <span>Open defaults</span>
          </SettingsRow>
        </form>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open profile/i }));
    fireEvent.click(screen.getByRole("button", { name: /Open defaults/i }));

    expect(onNav).toHaveBeenCalledTimes(1);
    expect(onRow).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
