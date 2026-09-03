import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderLogo } from "./ProviderLogo";

describe("ProviderLogo", () => {
  it("retries image loading when the provider changes after an image failure", () => {
    const { rerender } = render(<ProviderLogo slug="missing-provider" />);

    fireEvent.error(screen.getByAltText("missing-provider logo"));
    expect(screen.queryByAltText("missing-provider logo")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "missing-provider logo" })).toHaveTextContent("MP");

    rerender(<ProviderLogo slug="openai" />);

    const image = screen.getByAltText("openai logo");
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute("src", "/providers/provider_openai.png");
  });

  it("maps new provider slug aliases to logo assets", () => {
    const { rerender } = render(<ProviderLogo slug="recraft-ai" />);
    expect(screen.getByAltText("recraft-ai logo")).toHaveAttribute(
      "src",
      "/providers/provider_recraftai.png",
    );

    rerender(<ProviderLogo modelId="liquid/lfm-2-24b-a2b" />);
    expect(screen.getByAltText("liquid logo")).toHaveAttribute("src", "/providers/provider_liquid.png");

    rerender(<ProviderLogo slug="kwaivgi" />);
    expect(screen.getByAltText("kwaivgi logo")).toHaveAttribute("src", "/providers/provider_kwaipilot.png");

    rerender(<ProviderLogo slug="reka" />);
    expect(screen.getByAltText("reka logo")).toHaveAttribute("src", "/providers/provider_rekaai.png");
  });

  it("resolves generation-provider assets from their canonical slugs", () => {
    const { rerender } = render(<ProviderLogo modelId="fish-audio/s1" />);
    expect(screen.getByAltText("fish-audio logo")).toHaveAttribute(
      "src",
      "/providers/provider_fish_audio.png",
    );

    rerender(<ProviderLogo modelId="dots-studio/image-model" />);
    expect(screen.getByAltText("dots-studio logo")).toHaveAttribute(
      "src",
      "/providers/provider_dots_studio.png",
    );

    rerender(<ProviderLogo modelId="thinkingmachines/text-model" />);
    expect(screen.getByAltText("thinkingmachines logo")).toHaveAttribute(
      "src",
      "/providers/provider_thinkingmachines.png",
    );
  });

  it("extracts the provider when slug receives a full model id", () => {
    const { rerender } = render(<ProviderLogo slug="openai/gpt-4o" />);
    expect(screen.getByAltText("openai logo")).toHaveAttribute("src", "/providers/provider_openai.png");

    rerender(<ProviderLogo slug="~anthropic/claude-opus-latest" />);
    expect(screen.getByAltText("anthropic logo")).toHaveAttribute("src", "/providers/provider_anthropic.png");
  });
});
