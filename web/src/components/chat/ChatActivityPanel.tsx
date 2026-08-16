import type { ReactNode } from "react";

const BUTTON_TONES = {
  orange: "border-orange-500/40 text-orange-400 hover:bg-orange-500/10",
  green: "border-green-500/40 text-green-400 hover:bg-green-500/10",
  red: "border-red-500/40 text-red-400 hover:bg-red-500/10",
  muted: "border-border/40 text-muted hover:bg-surface-2",
} as const;

export function ChatActivityPanel({ children }: { children: ReactNode }) {
  return (
    <div className="mx-3 mb-2 rounded-2xl border border-border/40 bg-surface-1/90 px-4 py-3 shadow-sm backdrop-blur-md">
      {children}
    </div>
  );
}

export function ChatActivityButton({
  label,
  icon,
  tone,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  tone: keyof typeof BUTTON_TONES;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${BUTTON_TONES[tone]}`}
    >
      {icon}
      {label}
    </button>
  );
}
