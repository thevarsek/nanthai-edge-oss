import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { ChatSkillsPicker } from "./ChatSkillsPicker";

vi.mock("@/hooks/useSharedData", () => ({
  useVisibleSkills: () => [
    { _id: "skill_research", name: "Research", summary: "Find sources" },
    { _id: "skill_code", name: "Code", summary: "Write patches" },
    {
      _id: "skill_music",
      name: "Music Generation",
      summary: "Generate music",
      mediaAvailability: {
        profile: "musicGeneration",
        generationKind: "music",
        modelId: "music/non-zdr",
        isAvailable: false,
        reasonCode: "zdr_incompatible_model",
      },
    },
  ],
}));

describe("ChatSkillsPicker", () => {
  it("renders inherited and overridden skill states and cycles clicked rows", () => {
    const onCycleSkill = vi.fn();

    render(
      <ChatSkillsPicker
        skillOverrides={new Map([["skill_research", "always"]])}
        onCycleSkill={onCycleSkill}
        onDisableSkill={vi.fn()}
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
        onDisableSkill={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  code  " } });

    expect(screen.getByText("Code")).toBeInTheDocument();
    expect(screen.queryByText("Research")).not.toBeInTheDocument();
  });

  it("keeps an incompatible media skill visible but prevents activation", () => {
    const onCycleSkill = vi.fn();
    const onDisableSkill = vi.fn();
    render(
      <ChatSkillsPicker
        skillOverrides={new Map()}
        onCycleSkill={onCycleSkill}
        onDisableSkill={onDisableSkill}
        onClose={vi.fn()}
      />,
    );

    const music = screen.getByRole("button", { name: /Music Generation/i });
    expect(music).toBeDisabled();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    fireEvent.click(music);
    expect(onCycleSkill).not.toHaveBeenCalled();
    expect(onDisableSkill).not.toHaveBeenCalled();
  });

  it("allows an active incompatible skill to be turned off directly", () => {
    const onCycleSkill = vi.fn();
    const onDisableSkill = vi.fn();
    render(
      <ChatSkillsPicker
        skillOverrides={new Map([["skill_music", "always"]])}
        onCycleSkill={onCycleSkill}
        onDisableSkill={onDisableSkill}
        onClose={vi.fn()}
      />,
    );

    const music = screen.getByRole("button", { name: /Music Generation/i });
    expect(music).toBeEnabled();
    fireEvent.click(music);
    expect(onDisableSkill).toHaveBeenCalledWith("skill_music" as Id<"skills">);
    expect(onCycleSkill).not.toHaveBeenCalled();
  });
});
