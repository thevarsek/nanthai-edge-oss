// MenuSelect — iOS-style dropdown menu using a portal to escape overflow containers.
// Extracted from ChatDefaultsSection for reuse across chat panels.

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";

export interface MenuSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface MenuSelectProps {
  value: string;
  options: MenuSelectOption[];
  onChange: (v: string) => void;
}

export function MenuSelect({ value, options, onChange }: MenuSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const selected = options.find((o) => o.value === value);

  // Position the portal menu relative to trigger, flipping up if near bottom
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuHeight = Math.min(options.length * 36 + 8, 280);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const fitsBelow = spaceBelow >= menuHeight;
    setPos({
      top: fitsBelow ? rect.bottom + 4 : rect.top - menuHeight - 4,
      left: rect.right,
    });
  }, [open, options.length]);

  // Close on outside click or scroll
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        menuRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    };
    const handleScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-3 text-sm border border-border/50 hover:border-border transition-colors"
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown
          size={12}
          className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[9999] min-w-[10rem] max-h-[min(280px,calc(100vh-2rem))] overflow-y-auto py-1 rounded-xl bg-surface-1 border border-border/50 shadow-lg"
            style={{ top: pos.top, right: window.innerWidth - pos.left }}
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  if (!opt.disabled) {
                    onChange(opt.value);
                    setOpen(false);
                  }
                }}
                disabled={opt.disabled}
                className={[
                  "w-full flex items-center justify-between gap-3 px-3 py-2 text-sm text-left transition-colors",
                  opt.disabled
                    ? "opacity-40 cursor-not-allowed"
                    : "hover:bg-surface-3",
                  opt.value === value ? "text-primary font-medium" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span>{opt.label}</span>
                {opt.value === value && (
                  <Check size={14} className="text-primary flex-shrink-0" />
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
