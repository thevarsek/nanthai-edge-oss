import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { PersonaCard, type PersonaCardData } from "./PersonaCard";

const persona: PersonaCardData = {
  _id: "personas_1" as Id<"personas">,
  displayName: "Research Lead",
  personaDescription: "Checks sources",
  avatarEmoji: "R",
  systemPrompt: "Verify claims.",
  isDefault: true,
};

describe("PersonaCard", () => {
  test("renders list actions visibly and dispatches callbacks with persona id", () => {
    const onNewChat = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <PersonaCard
        persona={persona}
        view="list"
        onNewChat={onNewChat}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByText("Research Lead")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByTitle("New chat").parentElement).toHaveClass("opacity-100");

    fireEvent.click(screen.getByTitle("New chat"));
    fireEvent.click(screen.getByTitle("Edit"));
    fireEvent.click(screen.getByTitle("Delete"));

    expect(onNewChat).toHaveBeenCalledWith(persona._id);
    expect(onEdit).toHaveBeenCalledWith(persona._id);
    expect(onDelete).toHaveBeenCalledWith(persona._id);
  });

  test("prefers avatar image over emoji and disables pending new-chat action", () => {
    render(
      <PersonaCard
        persona={{ ...persona, avatarImageUrl: "https://files.convex.site/download?filename=avatar.png" }}
        view="grid"
        onNewChat={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        isNewChatPending
      />,
    );

    expect(screen.getByRole("img", { name: "Research Lead" })).toHaveAttribute(
      "src",
      "https://files.convex.site/download?filename=avatar.png",
    );
    expect(screen.getByRole("img", { name: "Research Lead" })).toHaveAttribute(
      "referrerpolicy",
      "no-referrer",
    );
    expect(screen.getByRole("button", { name: /new chat/i })).toBeDisabled();
  });

  test("falls back when avatar image URL uses an untrusted source", () => {
    render(
      <PersonaCard
        persona={{ ...persona, avatarImageUrl: "https://example.test/avatar.png", avatarEmoji: "R" }}
        view="grid"
        onNewChat={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.queryByRole("img", { name: "Research Lead" })).not.toBeInTheDocument();
    expect(screen.getByText("R")).toBeInTheDocument();
  });
});
