import { useEffect, useCallback, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSharedData } from "@/hooks/useSharedData";
import { usePreferenceBuffer } from "@/hooks/usePreferenceBuffer";
import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher";

// ─── Types ─────────────────────────────────────────────────────────────────

type AppearanceMode = "light" | "dark" | "system";
type ColorTheme = "vibrant" | "highContrast" | "teal" | "lilac";
const PENDING_ECHO_GUARD_MS = 5_000;

interface PendingPreference<T> {
  value: T;
  timeoutId: number;
}

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
  const transitionTimeoutRef = useRef<number | null>(null);

  const serverMode: AppearanceMode =
    (prefs?.appearanceMode as AppearanceMode | undefined) ?? "system";

  const serverColorTheme: ColorTheme =
    (prefs?.colorTheme as ColorTheme | undefined) ?? "vibrant";
  const latestServerModeRef = useRef(serverMode);
  const latestServerColorThemeRef = useRef(serverColorTheme);
  const [localMode, setLocalMode] = useState(serverMode);
  const [localColorTheme, setLocalColorTheme] = useState(serverColorTheme);
  const pendingModeRef = useRef<PendingPreference<AppearanceMode> | null>(null);
  const pendingColorThemeRef = useRef<PendingPreference<ColorTheme> | null>(null);
  const currentMode = localMode;
  const currentColorTheme = localColorTheme;

  const startPendingMode = (mode: AppearanceMode) => {
    if (pendingModeRef.current) window.clearTimeout(pendingModeRef.current.timeoutId);
    const timeoutId = window.setTimeout(() => {
      if (pendingModeRef.current?.value === mode) {
        pendingModeRef.current = null;
        setLocalMode(latestServerModeRef.current);
      }
    }, PENDING_ECHO_GUARD_MS);
    pendingModeRef.current = { value: mode, timeoutId };
  };

  const startPendingColorTheme = (theme: ColorTheme) => {
    if (pendingColorThemeRef.current) window.clearTimeout(pendingColorThemeRef.current.timeoutId);
    const timeoutId = window.setTimeout(() => {
      if (pendingColorThemeRef.current?.value === theme) {
        pendingColorThemeRef.current = null;
        setLocalColorTheme(latestServerColorThemeRef.current);
      }
    }, PENDING_ECHO_GUARD_MS);
    pendingColorThemeRef.current = { value: theme, timeoutId };
  };

  useEffect(() => {
    latestServerModeRef.current = serverMode;
  }, [serverMode]);

  useEffect(() => {
    latestServerColorThemeRef.current = serverColorTheme;
  }, [serverColorTheme]);

  useEffect(() => {
    const pending = pendingModeRef.current;
    if (pending) {
      if (serverMode === pending.value) {
        window.clearTimeout(pending.timeoutId);
        pendingModeRef.current = null;
      } else if (serverMode !== localMode) {
        return;
      }
    }
    const timer = window.setTimeout(() => setLocalMode(serverMode), 0);
    return () => window.clearTimeout(timer);
  }, [serverMode, localMode]);

  useEffect(() => {
    const pending = pendingColorThemeRef.current;
    if (pending) {
      if (serverColorTheme === pending.value) {
        window.clearTimeout(pending.timeoutId);
        pendingColorThemeRef.current = null;
      } else if (serverColorTheme !== localColorTheme) {
        return;
      }
    }
    const timer = window.setTimeout(() => setLocalColorTheme(serverColorTheme), 0);
    return () => window.clearTimeout(timer);
  }, [serverColorTheme, localColorTheme]);

  const applyTheme = useCallback((mode: AppearanceMode) => {
    const root = document.documentElement;
    // Enable smooth color transition
    if (transitionTimeoutRef.current != null) {
      window.clearTimeout(transitionTimeoutRef.current);
    }
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
    transitionTimeoutRef.current = window.setTimeout(() => {
      root.classList.remove("theme-transition");
      transitionTimeoutRef.current = null;
    }, 350);
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
    applyTheme(currentMode);
  }, [applyTheme, currentMode]);

  useEffect(() => {
    applyColorTheme(currentColorTheme);
  }, [currentColorTheme]);

  useEffect(() => {
    if (currentMode !== "system") return undefined;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => applyTheme("system");
    media.addEventListener("change", handleSystemThemeChange);

    return () => {
      media.removeEventListener("change", handleSystemThemeChange);
    };
  }, [applyTheme, currentMode]);

  useEffect(() => () => {
    if (transitionTimeoutRef.current != null) {
      window.clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
    if (pendingModeRef.current) window.clearTimeout(pendingModeRef.current.timeoutId);
    if (pendingColorThemeRef.current) window.clearTimeout(pendingColorThemeRef.current.timeoutId);
    document.documentElement.classList.remove("theme-transition");
  }, []);

  const handleModeChange = (mode: AppearanceMode) => {
    if (mode !== localMode) {
      startPendingMode(mode);
      setLocalMode(mode);
    }
    updatePreference({ appearanceMode: mode });
    applyTheme(mode);
  };

  const handleColorThemeChange = (theme: ColorTheme) => {
    if (theme !== localColorTheme) {
      startPendingColorTheme(theme);
      setLocalColorTheme(theme);
    }
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
                type="button"
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
                type="button"
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
