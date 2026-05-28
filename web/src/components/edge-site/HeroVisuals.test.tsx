import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HeroOutlineText } from "./HeroOutlineText";

vi.mock("vanta/dist/vanta.net.min", () => ({
  default: vi.fn(() => ({ destroy: vi.fn() })),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  Object.defineProperty(SVGSVGElement.prototype, "getBBox", {
    configurable: true,
    value: vi.fn(() => ({
    x: 0,
    y: 0,
    width: 300,
    height: 100,
    })),
  });
});

describe("edge-site hero visuals", () => {
  it("renders outline text with plain, legacy accent, and segmented lines", () => {
    render(
      <HeroOutlineText
        lines={[
          "NanthAI",
          { text: "Edge:", accentSuffix: ":" },
          [{ text: "BY", accent: true }, { text: "OK" }],
        ]}
        align="left"
      />,
    );

    expect(screen.getByLabelText("NanthAI Edge: BYOK")).toBeInTheDocument();
  });

  it("skips Vanta initialization when reduced motion is enabled", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const vanta = await import("vanta/dist/vanta.net.min");
    const { HeroVantaNet } = await import("./HeroVantaNet");

    render(<HeroVantaNet />);

    expect(vanta.default).not.toHaveBeenCalled();
  });

  it("initializes and destroys the Vanta background when motion is allowed", async () => {
    const destroy = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const vanta = await import("vanta/dist/vanta.net.min");
    vi.mocked(vanta.default).mockReturnValue({ destroy });
    const { HeroVantaNet } = await import("./HeroVantaNet");

    const { unmount } = render(<HeroVantaNet opacity={0.2} />);
    expect(vanta.default).toHaveBeenCalledWith(expect.objectContaining({
      el: expect.any(HTMLDivElement),
      mouseControls: true,
      touchControls: true,
    }));

    unmount();
    expect(destroy).toHaveBeenCalled();
  });
});
