import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SharedDataContext, type SharedDataContextValue } from "@/hooks/useSharedData";
import { PersonaAvatar } from "./PersonaAvatar";

describe("PersonaAvatar", () => {
  it("falls back through emoji, initial, and generic icon tiers", () => {
    const { rerender, container } = render(
      <PersonaAvatar personaName="Ada" personaEmoji="A" />,
    );

    expect(screen.getByText("A")).toBeInTheDocument();

    rerender(<PersonaAvatar personaName="Grace" />);
    expect(screen.getByText("G")).toBeInTheDocument();

    rerender(<PersonaAvatar />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("retries rendering an image when the avatar URL changes after a failed URL", () => {
    const { rerender } = render(
      <PersonaAvatar personaName="Ada" personaAvatarImageUrl="https://files.convex.site/download?filename=old.png" />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Ada" }));
    expect(screen.queryByRole("img", { name: "Ada" })).not.toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();

    rerender(
      <PersonaAvatar personaName="Ada" personaAvatarImageUrl="https://files.convex.site/download?filename=new.png" />,
    );

    expect(screen.getByRole("img", { name: "Ada" })).toHaveAttribute(
      "src",
      "https://files.convex.site/download?filename=new.png",
    );
  });

  it("resolves personaId from shared data before direct fallback props", () => {
    const sharedData = {
      personas: [
        {
          _id: "persona_1",
          displayName: "Context Persona",
          avatarEmoji: "C",
          avatarImageUrl: "https://files.convex.site/download?filename=context.png",
        },
      ],
    } as unknown as SharedDataContextValue;

    render(
      <SharedDataContext.Provider value={sharedData}>
        <PersonaAvatar
          personaId="persona_1"
          personaName="Fallback Persona"
          personaEmoji="F"
          personaAvatarImageUrl="https://files.convex.site/download?filename=fallback.png"
        />
      </SharedDataContext.Provider>,
    );

    expect(screen.getByRole("img", { name: "Context Persona" })).toHaveAttribute(
      "src",
      "https://files.convex.site/download?filename=context.png",
    );
    expect(screen.getByRole("img", { name: "Context Persona" })).toHaveAttribute(
      "referrerpolicy",
      "no-referrer",
    );
  });

  it("rejects untrusted avatar image URLs", () => {
    render(
      <PersonaAvatar
        personaName="Ada"
        personaEmoji="A"
        personaAvatarImageUrl="https://example.test/tracker.png"
      />,
    );

    expect(screen.queryByRole("img", { name: "Ada" })).not.toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });
});
