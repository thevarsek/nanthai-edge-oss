import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppearanceSection } from "./AppearanceSection";

let prefs: { appearanceMode?: string; colorTheme?: string } = { appearanceMode: "dark", colorTheme: "vibrant" };

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/useSharedData", () => ({
  useSharedData: () => ({ prefs }),
}));

vi.mock("@/hooks/usePreferenceBuffer", () => ({
  usePreferenceBuffer: () => ({ updatePreference: vi.fn() }),
}));

vi.mock("@/components/shared/LanguageSwitcher", () => ({
  LanguageSwitcher: () => null,
}));

describe("AppearanceSection", () => {
  afterEach(() => {
    prefs = { appearanceMode: "dark", colorTheme: "vibrant" };
    vi.useRealTimers();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-color-theme");
    localStorage.clear();
  });

  it("removes the global theme transition class when unmounted before the timeout", () => {
    vi.useFakeTimers();

    const { unmount } = render(<AppearanceSection />);

    expect(document.documentElement.classList.contains("theme-transition")).toBe(true);
    unmount();

    expect(document.documentElement.classList.contains("theme-transition")).toBe(false);
  });

  it("applies system appearance when preferences are missing", () => {
    prefs = {};
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    render(<AppearanceSection />);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("nanth_theme")).toBeNull();
  });

  it("adopts later server appearance changes after active option no-op clicks", async () => {
    const { rerender } = render(<AppearanceSection />);

    fireEvent.click(screen.getByRole("button", { name: "dark" }));
    fireEvent.click(screen.getByRole("button", { name: "vibrant" }));
    prefs = { appearanceMode: "light", colorTheme: "teal" };
    rerender(<AppearanceSection />);

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "light");
      expect(document.documentElement).toHaveAttribute("data-color-theme", "teal");
    });
  });

  it("ignores stale appearance echoes behind the latest local selection", async () => {
    const { rerender } = render(<AppearanceSection />);

    fireEvent.click(screen.getByRole("button", { name: "light" }));
    fireEvent.click(screen.getByRole("button", { name: "dark" }));
    prefs = { appearanceMode: "light", colorTheme: "vibrant" };
    rerender(<AppearanceSection />);

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    });
  });

  it("ignores stale color theme echoes behind the latest local selection", async () => {
    const { rerender } = render(<AppearanceSection />);

    fireEvent.click(screen.getByRole("button", { name: "teal" }));
    fireEvent.click(screen.getByRole("button", { name: "vibrant" }));
    prefs = { appearanceMode: "dark", colorTheme: "teal" };
    rerender(<AppearanceSection />);

    await waitFor(() => {
      expect(document.documentElement).not.toHaveAttribute("data-color-theme");
    });
  });
});
