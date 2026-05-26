// SegmentedControl — iOS-style segmented picker.
// Extracted from ChatDefaultsSection for reuse across chat panels.

import type { KeyboardEvent } from "react";

export function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  "aria-label"?: string;
}) {
  const selectedIndex = Math.max(0, options.findIndex((opt) => opt.value === value));
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % options.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + options.length) % options.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = options.length - 1;
    }
    if (nextIndex == null) return;
    event.preventDefault();
    onChange(options[nextIndex].value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex w-full rounded-xl bg-surface-3 p-0.5 gap-0.5"
    >
      {options.map((opt, index) => (
        <button
          key={String(opt.value)}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          tabIndex={index === selectedIndex ? 0 : -1}
          onClick={() => onChange(opt.value)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          className={[
            "flex-1 px-3 py-1.5 text-xs font-medium rounded-[10px] transition-all text-center",
            value === opt.value
              ? "bg-primary text-white shadow-sm"
              : "text-muted hover:text-foreground",
          ].join(" ")}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
