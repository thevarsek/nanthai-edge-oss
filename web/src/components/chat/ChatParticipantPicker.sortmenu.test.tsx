import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SortMenuPortal } from "./ChatParticipantPicker.sortmenu";
import type { SortKey } from "@/components/shared/ModelPickerShared";

const sortIcons = {
  recommended: <span>R</span>,
  coding: <span>C</span>,
  research: <span>R</span>,
  image: <span>I</span>,
  context: <span>C</span>,
  price: <span>$</span>,
  fast: <span>F</span>,
  value: <span>V</span>,
  topThisWeek: <span>T</span>,
} satisfies Record<SortKey, React.ReactNode>;

describe("SortMenuPortal", () => {
  it("renders options in a portal and closes after selecting an option", () => {
    const onChange = vi.fn();
    render(<SortMenuPortal sortKey="recommended" onChange={onChange} sortIcons={sortIcons} />);

    fireEvent.click(screen.getByRole("button", { name: /recommended/i }));

    const codingOption = screen.getByRole("button", { name: /coding/i });
    expect(codingOption.parentElement).toBe(document.body.lastElementChild);
    expect(screen.getAllByRole("button", { name: /recommended/i })[1]?.querySelector(".lucide-check")).toBeInTheDocument();

    fireEvent.click(codingOption);

    expect(onChange).toHaveBeenCalledWith("coding");
    expect(screen.queryByRole("button", { name: /research/i })).not.toBeInTheDocument();
  });

  it("closes when clicking outside the portal", () => {
    render(
      <div>
        <button type="button">Outside</button>
        <SortMenuPortal sortKey="recommended" onChange={vi.fn()} sortIcons={sortIcons} />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: /recommended/i }));
    expect(screen.getByRole("button", { name: /research/i })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));

    expect(screen.queryByRole("button", { name: /research/i })).not.toBeInTheDocument();
  });
});
