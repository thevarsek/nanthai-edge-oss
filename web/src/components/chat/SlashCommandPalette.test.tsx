import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SlashCommandPalette } from "./SlashCommandPalette";

vi.mock("@/hooks/useSharedData", () => ({
  useVisibleSkills: () => [
    { _id: "skills_research", name: "Research", summary: "Find sources" },
    { _id: "skills_write", name: "Write", summary: "Draft text" },
  ],
}));

const connectedProviders = {
  gmail: true,
  google: true,
  microsoft: false,
  apple: false,
  notion: false,
  cloze: false,
  slack: false,
};

describe("SlashCommandPalette", () => {
  it("filters already selected overrides and returns selected values", () => {
    const onSelectSkill = vi.fn();
    const onSelectIntegration = vi.fn();

    render(
      <SlashCommandPalette
        onSelectSkill={onSelectSkill}
        onSelectIntegration={onSelectIntegration}
        onDismiss={vi.fn()}
        turnSkillOverrides={new Map([["skills_write", "always"]])}
        turnIntegrationOverrides={new Map([["gmail", true]])}
        connectedProviders={connectedProviders}
      />,
    );

    expect(screen.queryByRole("button", { name: /Write/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Gmail/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Research/i }));
    expect(onSelectSkill).toHaveBeenCalledWith("skills_research", "Research");

    fireEvent.click(screen.getByRole("button", { name: /Google Drive/i }));
    expect(onSelectIntegration).toHaveBeenCalledWith("drive", "Google Drive");
  });

  it("dismisses with Escape after focus moves to a command row", () => {
    const onDismiss = vi.fn();
    render(
      <SlashCommandPalette
        onSelectSkill={vi.fn()}
        onSelectIntegration={vi.fn()}
        onDismiss={onDismiss}
        turnSkillOverrides={new Map()}
        turnIntegrationOverrides={new Map()}
        connectedProviders={connectedProviders}
      />,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: /Research/i }), { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state when no command matches search", () => {
    render(
      <SlashCommandPalette
        onSelectSkill={vi.fn()}
        onSelectIntegration={vi.fn()}
        onDismiss={vi.fn()}
        turnSkillOverrides={new Map()}
        turnIntegrationOverrides={new Map()}
        connectedProviders={connectedProviders}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzz" } });
    expect(screen.getByText("No Results")).toBeInTheDocument();
  });
});
