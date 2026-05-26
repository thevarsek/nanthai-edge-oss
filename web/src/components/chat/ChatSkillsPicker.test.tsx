import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { ChatSkillsPicker } from "./ChatSkillsPicker";

vi.mock("@/hooks/useSharedData", () => ({
  useVisibleSkills: () => [
    { _id: "skill_research", name: "Research", summary: "Find sources" },
    { _id: "skill_code", name: "Code", summary: "Write patches" },
  ],
}));

describe("ChatSkillsPicker", () => {
  it("renders inherited and overridden skill states and cycles clicked rows", () => {
    const onCycleSkill = vi.fn();

    render(
      <ChatSkillsPicker
        skillOverrides={new Map([["skill_research", "always"]])}
        onCycleSkill={onCycleSkill}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Always On")).toBeInTheDocument();
    expect(screen.getByText("Inherit")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Research/i }));
    fireEvent.click(screen.getByRole("button", { name: /Code/i }));

    expect(onCycleSkill).toHaveBeenNthCalledWith(1, "skill_research" as Id<"skills">);
    expect(onCycleSkill).toHaveBeenNthCalledWith(2, "skill_code" as Id<"skills">);
  });

  it("trims whitespace before filtering skills", () => {
    render(
      <ChatSkillsPicker
        skillOverrides={new Map()}
        onCycleSkill={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  code  " } });

    expect(screen.getByText("Code")).toBeInTheDocument();
    expect(screen.queryByText("Research")).not.toBeInTheDocument();
  });
});
