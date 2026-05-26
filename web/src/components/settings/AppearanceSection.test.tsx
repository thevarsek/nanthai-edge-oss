import { render } from "@testing-library/react";
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
});
