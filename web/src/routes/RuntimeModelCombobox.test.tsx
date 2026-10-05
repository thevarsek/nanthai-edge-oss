import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RuntimeModelCombobox } from "./RuntimeModelCombobox";
const models = [
  { displayName: "Sol", provider: "openai", modelId: "sol", availability: "available" },
  { displayName: "Sol", provider: "other", modelId: "sol", availability: "available" },
];
describe("RuntimeModelCombobox", () => {
  it("keeps search inside the picker and preserves provider identity with keyboard choice", () => {
    const select = vi.fn();
    render(<RuntimeModelCombobox models={models} selectedIndex={-1} onSelect={select} />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "other" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    expect(select).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveFocus();
  });
  it("shows empty results and closes with Escape without changing selection", () => {
    const select = vi.fn();
    render(<RuntimeModelCombobox models={models} selectedIndex={0} onSelect={select} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
    expect(screen.getByRole("status")).toHaveTextContent("No models match your current search or filters.");
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(select).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
  });
});
