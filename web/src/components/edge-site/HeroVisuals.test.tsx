import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HeroOutlineText } from "./HeroOutlineText";
import { HeroSpotlight } from "./HeroSpotlight";

vi.mock("vanta/dist/vanta.net.min", () => ({
  default: vi.fn(() => ({ destroy: vi.fn() })),
}));

function stubMotionPreference(matches: boolean) {
  let currentMatches = matches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQueryList = {
    get matches() {
      return currentMatches;
    },
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
      if (event === "change") listeners.add(listener);
    }),
    removeEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
      if (event === "change") listeners.delete(listener);
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatch(nextMatches: boolean) {
      currentMatches = nextMatches;
      const event = { matches: nextMatches, media: mediaQueryList.media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
    dispatchEvent: vi.fn(),
  } as MediaQueryList & { dispatch(nextMatches: boolean): void };

  vi.stubGlobal("matchMedia", vi.fn(() => mediaQueryList));
  return mediaQueryList;
}

function renderIntoParent(ui: ReactElement) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const result = render(ui, { container: parent });
  return {
    parent,
    ...result,
    cleanup() {
      result.unmount();
      parent.remove();
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  it("keeps default right-aligned outline text visible before measurement", () => {
    render(<HeroOutlineText lines={["NanthAI"]} />);

    const svg = screen.getByLabelText("NanthAI");
    const text = svg.querySelector("text");

    expect(svg).toHaveAttribute("viewBox", "0 0 1000 200");
    expect(text).toHaveAttribute("x", "1000");
    expect(text).toHaveAttribute("text-anchor", "end");
  });

  it("remeasures outline text when alignment changes", async () => {
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const { rerender } = render(<HeroOutlineText lines={["NanthAI"]} align="left" />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    rerender(<HeroOutlineText lines={["NanthAI"]} align="right" />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it("skips Vanta initialization when reduced motion is enabled", async () => {
    stubMotionPreference(true);
    const vanta = await import("vanta/dist/vanta.net.min");
    const { HeroVantaNet } = await import("./HeroVantaNet");

    render(<HeroVantaNet />);

    expect(vanta.default).not.toHaveBeenCalled();
  });

  it("initializes and destroys the Vanta background when motion is allowed", async () => {
    const destroy = vi.fn();
    stubMotionPreference(false);
    const vanta = await import("vanta/dist/vanta.net.min");
    vi.mocked(vanta.default).mockReturnValue({ destroy });
    const { HeroVantaNet } = await import("./HeroVantaNet");

    const { unmount } = render(<HeroVantaNet opacity={0.2} />);
    expect(vanta.default).toHaveBeenCalledWith(expect.objectContaining({
      el: expect.any(HTMLDivElement),
      mouseControls: true,
      touchControls: true,
      backgroundAlpha: 0,
      backgroundColor: 0x050507,
      maxDistance: 22,
    }));

    unmount();
    expect(destroy).toHaveBeenCalled();
  });

  it("uses higher-contrast Vanta settings in light mode", async () => {
    document.documentElement.setAttribute("data-theme", "light");
    stubMotionPreference(false);
    const vanta = await import("vanta/dist/vanta.net.min");
    const material = {
      vertexColors: true,
      color: { set: vi.fn() },
      opacity: 1,
      transparent: true,
      blending: undefined,
      needsUpdate: false,
    };
    const vantaInstance = {
      destroy: vi.fn(),
      linesMesh: { material },
    } as unknown as ReturnType<typeof vanta.default>;
    vi.mocked(vanta.default).mockReturnValue(vantaInstance);
    const { HeroVantaNet } = await import("./HeroVantaNet");

    const { container } = render(
      <HeroVantaNet
        color={0x00e0d0}
        lightColor={0x00a7a0}
        opacity={0.2}
        lightOpacity={0.68}
        lightMaxDistance={30}
        lightLineColor={0x087b78}
        lightLineOpacity={0.46}
      />,
    );

    expect(vanta.default).toHaveBeenCalledWith(expect.objectContaining({
      color: 0x00a7a0,
      backgroundColor: 0x050507,
      maxDistance: 30,
    }));
    expect(container.firstElementChild).toHaveStyle({ opacity: "0.68" });
    expect(material.vertexColors).toBe(false);
    expect(material.color.set).toHaveBeenCalledWith(0x087b78);
    expect(material.opacity).toBe(0.46);
    expect(material.transparent).toBe(true);
    expect(material.needsUpdate).toBe(true);
  });

  it("destroys the Vanta background when reduced motion is enabled after mount", async () => {
    const destroy = vi.fn();
    const motionPreference = stubMotionPreference(false);
    const vanta = await import("vanta/dist/vanta.net.min");
    vi.mocked(vanta.default).mockReturnValue({ destroy });
    const { HeroVantaNet } = await import("./HeroVantaNet");

    render(<HeroVantaNet />);
    expect(vanta.default).toHaveBeenCalledTimes(1);

    act(() => motionPreference.dispatch(true));

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("updates the spotlight transform on parent mouse movement", () => {
    stubMotionPreference(false);
    let rafCallback: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      rafCallback = callback;
      return 7;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const { parent, cleanup } = renderIntoParent(<HeroSpotlight size={100} />);
    const container = parent.firstElementChild as HTMLElement;
    const spot = container.firstElementChild as HTMLElement;
    Object.defineProperty(container, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 100,
        top: 50,
        right: 500,
        bottom: 350,
        x: 100,
        y: 50,
        width: 400,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    fireEvent.mouseMove(parent, { clientX: 130, clientY: 90 });
    act(() => {
      rafCallback?.(0);
    });

    expect(spot.style.transform).toBe("translate3d(30px, 40px, 0) translate(-50%, -50%)");
    cleanup();
  });

  it("skips and cleans up spotlight motion listeners for reduced motion and unmount", () => {
    stubMotionPreference(true);
    const reducedParent = document.createElement("div");
    document.body.appendChild(reducedParent);
    const reducedAddEvent = vi.spyOn(reducedParent, "addEventListener");
    const reduced = render(<HeroSpotlight />, { container: reducedParent });

    expect(reducedAddEvent.mock.calls.some(([event, , options]) => (
      event === "mousemove" && typeof options === "object" && options !== null && "passive" in options
    ))).toBe(false);
    reduced.unmount();
    reducedParent.remove();

    stubMotionPreference(false);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 11));
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    const active = renderIntoParent(<HeroSpotlight />);
    const removeEvent = vi.spyOn(active.parent, "removeEventListener");

    fireEvent.mouseMove(active.parent, { clientX: 4, clientY: 8 });
    active.cleanup();

    expect(removeEvent.mock.calls.some(([event]) => event === "mousemove")).toBe(true);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(11);
  });
});
