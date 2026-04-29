import { useEffect, useCallback } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSharedData } from "@/hooks/useSharedData";
import { usePreferenceBuffer } from "@/hooks/usePreferenceBuffer";
import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher";

// ─── Types ─────────────────────────────────────────────────────────────────

type AppearanceMode = "light" | "dark" | "system";
type ColorTheme = "vibrant" | "highContrast" | "teal" | "lilac";

interface ThemeOption {
  value: AppearanceMode;
  labelKey: string;
}

interface ColorThemeOption {
  value: ColorTheme;
  labelKey: string;
  /** Exact hex from iOS asset catalog / Theme.swift */
  hex: string;
}

// ─── Data ──────────────────────────────────────────────────────────────────

const THEME_OPTIONS: ThemeOption[] = [
  { value: "system", labelKey: "system" },
  { value: "light", labelKey: "light" },
  { value: "dark", labelKey: "dark" },
];

const COLOR_THEME_OPTIONS: ColorThemeOption[] = [
  { value: "vibrant", labelKey: "vibrant", hex: "#FF6B3D" },
  { value: "highContrast", labelKey: "high_contrast", hex: "#D5381C" },
  { value: "teal", labelKey: "teal", hex: "#00B8D9" },
  { value: "lilac", labelKey: "lilac", hex: "#9A7CF2" },
];

// ─── Component ─────────────────────────────────────────────────────────────

export function AppearanceSection() {
  const { t } = useTranslation();
  const { prefs } = useSharedData();
  const { updatePreference } = usePreferenceBuffer();

  const currentMode: AppearanceMode =
    (prefs?.appearanceMode as AppearanceMode | undefined) ?? "system";

  const currentColorTheme: ColorTheme =
    (prefs?.colorTheme as ColorTheme | undefined) ?? "vibrant";

  const applyTheme = useCallback((mode: AppearanceMode) => {
    const root = document.documentElement;
    // Enable smooth color transition
    root.classList.add("theme-transition");
    if (mode === "dark") {
      root.setAttribute("data-theme", "dark");
      localStorage.setItem("nanth_theme", "dark");
    } else if (mode === "light") {
      root.setAttribute("data-theme", "light");
      localStorage.setItem("nanth_theme", "light");
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.setAttribute("data-theme", prefersDark ? "dark" : "light");
      localStorage.removeItem("nanth_theme");
    }
    // Remove the transition class after the transition completes
    setTimeout(() => root.classList.remove("theme-transition"), 350);
  }, []);

  const applyColorTheme = (theme: ColorTheme) => {
    if (theme === "vibrant") {
      document.documentElement.removeAttribute("data-color-theme");
    } else {
      document.documentElement.setAttribute("data-color-theme", theme);
    }
    localStorage.setItem("nanth_color_theme", theme);
  };

  // Sync document theme + color theme on prefs load
  useEffect(() => {
    if (!prefs?.appearanceMode) return;
    applyTheme(prefs.appearanceMode as AppearanceMode);
  }, [applyTheme, prefs?.appearanceMode]);

  useEffect(() => {
    applyColorTheme(currentColorTheme);
  }, [currentColorTheme]);

  const handleModeChange = (mode: AppearanceMode) => {
    updatePreference({ appearanceMode: mode });
    applyTheme(mode);
  };

  const handleColorThemeChange = (theme: ColorTheme) => {
    updatePreference({ colorTheme: theme });
    applyColorTheme(theme);
  };

  return (
    <div className="space-y-4">
      {/* Light/Dark/System — segmented-style list */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted uppercase tracking-wide px-1">
          {t("theme")}
        </h3>
        <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
          {THEME_OPTIONS.map(({ value, labelKey }) => {
            const isActive = currentMode === value;
            return (
              <button
                key={value}
                onClick={() => handleModeChange(value)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
              >
                <span className="flex-1 text-sm">{t(labelKey)}</span>
                {isActive && <Check size={16} strokeWidth={2.5} className="text-accent flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Color Theme picker */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted uppercase tracking-wide px-1">
          {t("color_theme")}
        </h3>
        <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
          {COLOR_THEME_OPTIONS.map(({ value, labelKey, hex }) => {
            const isActive = currentColorTheme === value;
            return (
              <button
                key={value}
                onClick={() => handleColorThemeChange(value)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
              >
                {/* Color dot */}
                <span
                  className="w-5 h-5 rounded-full flex-shrink-0 border border-border/30 shadow-sm"
                  style={{ background: hex }}
                />
                <span className="flex-1 text-sm">{t(labelKey)}</span>
                {isActive && <Check size={16} strokeWidth={2.5} className="text-accent flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
      {/* Language */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted uppercase tracking-wide px-1">
          {t("language")}
        </h3>
        <LanguageSwitcher variant="app" />
      </div>
    </div>
  );
}
