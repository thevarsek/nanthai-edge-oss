// components/chat/ChatParticipantPicker.sortmenu.tsx
// Sort menu dropdown for the participant picker.
// Portal-based to escape overflow:hidden containers.

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { ArrowUpDown, ChevronDown, Check } from "lucide-react";
import { type SortKey, SORT_KEYS } from "@/components/shared/ModelPickerShared";

interface SortMenuProps {
  sortKey: SortKey;
  onChange: (k: SortKey) => void;
  sortIcons: Record<SortKey, React.ReactNode>;
}

export function SortMenuPortal({ sortKey, onChange, sortIcons }: SortMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const current = SORT_KEYS.find((s) => s.key === sortKey);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuHeight = Math.min(SORT_KEYS.length * 36 + 8, 280);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const fitsBelow = spaceBelow >= menuHeight;
    setPos({
      top: fitsBelow ? rect.bottom + 4 : rect.top - menuHeight - 4,
      left: rect.left,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
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
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-surface-2 text-xs font-medium text-foreground hover:bg-surface-3 transition-colors"
      >
        <ArrowUpDown size={11} />
        {current ? t(current.labelKey) : t("sort")}
        <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] bg-surface-1 border border-border/50 rounded-xl shadow-lg py-1 min-w-[180px] max-h-[min(280px,calc(100vh-2rem))] overflow-y-auto"
          style={{ top: pos.top, left: pos.left }}
        >
          {SORT_KEYS.map((s) => (
            <button
              key={s.key}
              onClick={() => { onChange(s.key); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-2 transition-colors ${sortKey === s.key ? "text-primary" : "text-foreground"}`}
            >
              <span className="w-4">{sortIcons[s.key]}</span>
              <span className="flex-1 text-left">{t(s.labelKey)}</span>
              {sortKey === s.key && <Check size={12} className="text-primary" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
