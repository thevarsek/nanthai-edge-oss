// SegmentedControl — iOS-style segmented picker.
// Extracted from ChatDefaultsSection for reuse across chat panels.

export function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex w-full rounded-xl bg-surface-3 p-0.5 gap-0.5">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          onClick={() => onChange(opt.value)}
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
