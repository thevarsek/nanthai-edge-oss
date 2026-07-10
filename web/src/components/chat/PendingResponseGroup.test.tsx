import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { PendingResponseGroup } from "./PendingResponseGroup";

vi.mock("@/components/shared/PersonaAvatar", () => ({
  PersonaAvatar: ({
    personaId,
    personaName,
    personaEmoji,
  }: {
    personaId?: string;
    personaName?: string;
    personaEmoji?: string;
  }) => (
    <div data-testid="persona-avatar" data-persona-id={personaId}>
      {personaName ?? personaEmoji ?? personaId}
    </div>
  ),
}));

vi.mock("@/components/shared/ProviderLogo", () => ({
  ProviderLogo: ({ modelId }: { modelId: string }) => <div data-testid="provider-logo">{modelId}</div>,
}));

describe("PendingResponseGroup", () => {
  it("renders nothing when no pending participant exists", () => {
    const { container } = render(<PendingResponseGroup participants={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("uses provider fallbacks for model-only pending responses", () => {
    render(<PendingResponseGroup participants={[{ modelId: "anthropic/claude-sonnet-4" }]} />);

    expect(screen.getByTestId("provider-logo")).toHaveTextContent("anthropic/claude-sonnet-4");
    expect(screen.getByText("claude-sonnet-4")).toBeInTheDocument();
    expect(screen.getByText("...")).toBeInTheDocument();
  });

  it("uses persona avatars for persona-id-only pending responses", () => {
    render(
      <PendingResponseGroup
        participants={[
          {
            modelId: "openai/gpt-5.2",
            personaId: "persona_1" as Id<"personas">,
          },
        ]}
      />,
    );

    expect(screen.queryByTestId("provider-logo")).not.toBeInTheDocument();
    expect(screen.getByTestId("persona-avatar")).toHaveAttribute("data-persona-id", "persona_1");
  });

  it("groups multiple pending persona responses with persona avatars", () => {
    render(
      <PendingResponseGroup
        participants={[
          {
            modelId: "openai/gpt-5.2",
            personaId: "persona_1" as Id<"personas">,
            personaName: "Planner",
            personaEmoji: "P",
          },
          {
            modelId: "google/gemini-3-pro",
            personaId: "persona_2" as Id<"personas">,
            personaName: "Reviewer",
            personaEmoji: "R",
          },
        ]}
      />,
    );

    expect(screen.getAllByTestId("persona-avatar")).toHaveLength(2);
    expect(screen.getAllByText("Planner")).toHaveLength(2);
    expect(screen.getAllByText("Reviewer")).toHaveLength(2);
    expect(screen.queryByTestId("provider-logo")).not.toBeInTheDocument();
  });

  it("shows image cards only for image participants in a mixed pending group", () => {
    render(
      <PendingResponseGroup
        participants={[
          { modelId: "openai/gpt-image-2" },
          { modelId: "anthropic/claude-sonnet-4" },
        ]}
        imageGenerationModelIds={new Set(["openai/gpt-image-2"])}
      />,
    );

    const placeholder = screen.getByRole("status", { name: "Generating image..." });
    expect(placeholder.firstElementChild).toHaveClass("aspect-square");
    expect(screen.getByText("...")).toBeInTheDocument();
  });
});
