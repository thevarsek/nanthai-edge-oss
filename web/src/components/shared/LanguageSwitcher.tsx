import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Check, Globe } from "lucide-react";
import { SUPPORTED_LANGUAGES, type SupportedLanguageCode } from "@/i18n";

interface LanguageSwitcherProps {
  /** "app" renders a list-row style matching AppearanceSection;
   *  "header" renders a compact dropdown for site headers */
  variant?: "app" | "header";
}

export function LanguageSwitcher({ variant = "app" }: LanguageSwitcherProps) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const currentCode = (i18n.resolvedLanguage ?? i18n.language ?? "en") as SupportedLanguageCode;
  const currentLang = SUPPORTED_LANGUAGES.find((l) => l.code === currentCode);
  const currentLanguageLabel = currentLang?.label ?? currentCode;

  const handleSelect = (code: SupportedLanguageCode) => {
    void i18n.changeLanguage(code);
    setOpen(false);
    if (variant === "header") {
      triggerRef.current?.focus();
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // ─── App variant: list-row style (matches AppearanceSection) ──────────────
  if (variant === "app") {
    return (
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        {SUPPORTED_LANGUAGES.map(({ code, nativeLabel }) => {
          const isActive = currentCode === code;
          return (
            <button
              key={code}
              type="button"
              onClick={() => handleSelect(code)}
              aria-current={isActive ? "true" : undefined}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
            >
              <span className="flex-1 text-sm">{nativeLabel}</span>
              {isActive && (
                <Check aria-hidden="true" size={16} strokeWidth={2.5} className="text-accent flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // ─── Header variant: compact globe dropdown ────────────────────────────────
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Change language, current language: ${currentLanguageLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="group/btn inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[0.8rem] efg-40 transition-colors hover:efg-80"
      >
        <Globe aria-hidden="true" className="h-3.5 w-3.5" />
        <span>{currentLang?.nativeLabel ?? "EN"}</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Select language"
          className="absolute right-0 top-full mt-1 z-50 min-w-[10rem] rounded-xl border eborder-06 ebg-glass-02 backdrop-blur-xl shadow-lg py-1 overflow-hidden"
          style={{ background: `color-mix(in srgb, var(--edge-bg) 92%, transparent)` }}
        >
          {SUPPORTED_LANGUAGES.map(({ code, nativeLabel }) => {
            const isActive = currentCode === code;
            return (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => handleSelect(code)}
                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-[0.82rem] efg-50 hover:efg-80 hover:ebg-glass-04 transition-colors text-left"
              >
                <span>{nativeLabel}</span>
                {isActive && <Check aria-hidden="true" className="h-3.5 w-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
