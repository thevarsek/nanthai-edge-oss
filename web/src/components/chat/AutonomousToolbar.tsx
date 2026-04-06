// components/chat/AutonomousToolbar.tsx
// Active session control bar shown above message input during autonomous mode.
// Mirrors iOS AutonomousToolbar: status badge, cycle counter, pause/resume/stop.

import { Pause, Play, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AutonomousState } from "@/hooks/useAutonomous";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
  state: AutonomousState;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDismiss: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AutonomousToolbar({ state, onPause, onResume, onStop, onDismiss }: Props) {
  if (state.status === "inactive" || state.status === "configuring") return null;

  return (
    <div className="mx-3 mb-2 rounded-2xl bg-surface-1/90 backdrop-blur-md border border-border/40 px-4 py-3 space-y-2.5">
      <StatusRow state={state} />
      <Controls state={state} onPause={onPause} onResume={onResume} onStop={onStop} onDismiss={onDismiss} />
    </div>
  );
}

// ─── Status Row ─────────────────────────────────────────────────────────────

function StatusRow({ state }: { state: AutonomousState }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <StatusBadge state={state} />
      <CycleLabel state={state} />
      <div className="flex-1" />
      <RespondingLabel state={state} />
    </div>
  );
}

function StatusBadge({ state }: { state: AutonomousState }) {
  const { t } = useTranslation();
  if (state.status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <PulsingDot className="bg-green-500" />
        <span className="text-xs font-bold text-green-500 tracking-wide">{t("auto")}</span>
      </span>
    );
  }
  if (state.status === "paused") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Pause size={10} className="text-orange-500" />
        <span className="text-xs font-bold text-orange-500 tracking-wide">{t("paused_status")}</span>
      </span>
    );
  }
  if (state.status === "ended") {
    return (
      <span className="text-xs font-bold text-muted tracking-wide">{t("ended_status")}</span>
    );
  }
  return null;
}

function CycleLabel({ state }: { state: AutonomousState }) {
  const { t } = useTranslation();
  if (state.status === "active" || state.status === "paused") {
    return (
      <span className="text-xs text-muted font-mono tabular-nums">
        {t("cycle_n_of_n", { var1: state.cycle, var2: state.maxCycles })}
      </span>
    );
  }
  return null;
}

function RespondingLabel({ state }: { state: AutonomousState }) {
  const { t } = useTranslation();
  if (state.status === "active") {
    return (
      <span className="text-xs text-muted truncate max-w-40">
        {t("arg_responding", { var1: state.currentParticipant })}
      </span>
    );
  }
  if (state.status === "ended") {
    return (
      <span className="text-xs text-muted truncate max-w-52">{state.reason}</span>
    );
  }
  return null;
}

// ─── Control Buttons ────────────────────────────────────────────────────────

function Controls({ state, onPause, onResume, onStop, onDismiss }: {
  state: AutonomousState;
  onPause: () => void; onResume: () => void; onStop: () => void; onDismiss: () => void;
}) {
  const { t } = useTranslation();
  if (state.status === "active") {
    return (
      <div className="flex gap-2">
        <ToolbarButton label={t("pause")} icon={<Pause size={14} />} color="orange" onClick={onPause} />
        <ToolbarButton label={t("stop")} icon={<Square size={14} />} color="red" onClick={onStop} />
      </div>
    );
  }
  if (state.status === "paused") {
    return (
      <div className="flex gap-2">
        <ToolbarButton label={t("resume")} icon={<Play size={14} />} color="green" onClick={onResume} />
        <ToolbarButton label={t("stop")} icon={<Square size={14} />} color="red" onClick={onStop} />
      </div>
    );
  }
  if (state.status === "ended") {
    return (
      <div className="flex gap-2">
        <ToolbarButton label={t("dismiss")} icon={<X size={14} />} color="muted" onClick={onDismiss} />
      </div>
    );
  }
  return null;
}

// ─── Shared sub-components ──────────────────────────────────────────────────

const COLOR_MAP: Record<string, string> = {
  orange: "border-orange-500/40 text-orange-400 hover:bg-orange-500/10",
  green: "border-green-500/40 text-green-400 hover:bg-green-500/10",
  red: "border-red-500/40 text-red-400 hover:bg-red-500/10",
  muted: "border-border/40 text-muted hover:bg-surface-2",
};

function ToolbarButton({ label, icon, color, onClick }: {
  label: string; icon: React.ReactNode; color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors ${COLOR_MAP[color] ?? COLOR_MAP.muted}`}
    >
      {icon}
      {label}
    </button>
  );
}

function PulsingDot({ className }: { className?: string }) {
  return (
    <span className={`relative inline-block w-2 h-2 rounded-full ${className ?? ""}`}>
      <span className={`absolute inset-0 rounded-full animate-ping opacity-50 ${className ?? ""}`} />
    </span>
  );
}
