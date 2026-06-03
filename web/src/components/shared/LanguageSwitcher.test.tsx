import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageSwitcher } from "./LanguageSwitcher";

const languageMock = vi.hoisted(() => {
  const changeLanguage = vi.fn();
  return {
    changeLanguage,
    i18n: {
      language: "en",
      resolvedLanguage: "en",
      changeLanguage,
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: languageMock.i18n,
  }),
}));

describe("LanguageSwitcher", () => {
  beforeEach(() => {
    languageMock.i18n.language = "en";
    languageMock.i18n.resolvedLanguage = "en";
    languageMock.changeLanguage.mockClear();
  });

  it("marks the current app language and changes language from the app row", () => {
    render(<LanguageSwitcher variant="app" />);

    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-current", "true");

    fireEvent.click(screen.getByRole("button", { name: "Français" }));

    expect(languageMock.changeLanguage).toHaveBeenCalledWith("fr");
  });

  it("exposes the current language in the header trigger and selected menu item", () => {
    render(<LanguageSwitcher variant="header" />);

    const trigger = screen.getByRole("button", { name: "Change language, current language: English" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");

    fireEvent.click(trigger);

    expect(screen.getByRole("menuitemradio", { name: "English" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Español" })).toHaveAttribute("aria-checked", "false");
  });

  it("dismisses the header dropdown with Escape and restores focus to the trigger", () => {
    render(<LanguageSwitcher variant="header" />);

    const trigger = screen.getByRole("button", { name: "Change language, current language: English" });
    fireEvent.click(trigger);
    const englishOption = screen.getByRole("menuitemradio", { name: "English" });
    englishOption.focus();
    expect(englishOption).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menuitemradio", { name: "English" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("changes language from the header menu and closes back to the trigger", () => {
    render(<LanguageSwitcher variant="header" />);

    const trigger = screen.getByRole("button", { name: "Change language, current language: English" });
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Español" }));

    expect(languageMock.changeLanguage).toHaveBeenCalledWith("es");
    expect(screen.queryByRole("menuitemradio", { name: "Español" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
