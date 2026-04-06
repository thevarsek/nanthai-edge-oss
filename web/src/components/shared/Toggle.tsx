// Toggle.tsx — shared iOS-style toggle component.
// Matches iOS .tint(Color.brandPrimary) behavior:
// when ON, background shows the brand primary color.

interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  size?: "default" | "small";
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  size = "default",
}: ToggleProps) {
  const isSmall = size === "small";
  const trackW = isSmall ? "w-9" : "w-11";
  const trackH = isSmall ? "h-5" : "h-6";
  const thumbSize = isSmall ? "h-3.5 w-3.5" : "h-4 w-4";
  const thumbOn = isSmall ? "translate-x-[18px]" : "translate-x-6";
  const thumbOff = "translate-x-1";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={[
        "relative inline-flex items-center rounded-full transition-colors duration-200 flex-shrink-0",
        trackW,
        trackH,
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
        checked
          ? "bg-primary"
          : "bg-foreground/20",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block transform rounded-full bg-white shadow-sm transition-transform duration-200",
          thumbSize,
          checked ? thumbOn : thumbOff,
        ].join(" ")}
      />
    </button>
  );
}
