// components/chat/AutonomousSettingsDrawer.tsx
// Configuration sheet for autonomous group chat mode.
// Mirrors iOS AutonomousSettingsSheet: max cycles, pause, consensus, moderator, cost, start.

import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  X, Zap, CircleCheck, Circle,
  CheckCircle, AlertTriangle, OctagonAlert,
} from "lucide-react";
import type { Participant } from "@/hooks/useChat";
import {
  type AutonomousSettings,
  estimateAutonomousCost,
  type CostWarningLevel,
} from "@/hooks/useAutonomous";
import {
  participantKey,
  resolveSelectedParticipantId,
} from "@/lib/autonomousParticipants";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
  settings: AutonomousSettings;
  onChange: (settings: AutonomousSettings) => void;
  participants: Participant[];
  hasMessages: boolean;
  onStart: () => void;
  onClose: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AutonomousSettingsDrawer({
  settings, onChange, participants, hasMessages, onStart, onClose,
}: Props) {
  const { t } = useTranslation();

  const update = useCallback(
    (patch: Partial<AutonomousSettings>) => onChange({ ...settings, ...patch }),
    [settings, onChange],
  );

  const resolvedModeratorParticipantId = useMemo(
    () => resolveSelectedParticipantId(settings.moderatorParticipantId, participants),
    [participants, settings.moderatorParticipantId],
  );
  const resolvedSettings = useMemo(
    () => ({ ...settings, moderatorParticipantId: resolvedModeratorParticipantId }),
    [settings, resolvedModeratorParticipantId],
  );
  const { cost, warning } = useMemo(
    () => estimateAutonomousCost(resolvedSettings, participants.length),
    [resolvedSettings, participants.length],
  );

  // Number of turn-takers (excluding moderator)
  const turnTakerCount = useMemo(() => {
    if (!resolvedModeratorParticipantId) return participants.length;
    return participants.filter((participant, i) => participantKey(participant, i) !== resolvedModeratorParticipantId).length;
  }, [participants, resolvedModeratorParticipantId]);

  const totalTurns = settings.maxCycles * turnTakerCount;

  const canStart = turnTakerCount >= 2 && hasMessages;

  const handleStart = useCallback(() => {
    if (!canStart) return;
    onStart();
    onClose();
  }, [canStart, onStart, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg bg-surface-1 rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "85vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-primary" />
            <h2 className="text-base font-semibold">{t("autonomous_mode")}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-3 text-muted hover:text-foreground transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5 overflow-y-auto flex-1">
          {/* ── Discussion Settings ─────────────────────────── */}
          <SettingsSection title={t("discussion_settings")} footer={turnsFooter(t, turnTakerCount, totalTurns)}>
            <SliderRow
              label={t("max_cycles")}
              value={settings.maxCycles}
              min={1} max={20} step={1}
              format={(v) => String(v)}
              onChange={(v) => update({ maxCycles: v })}
            />
            <SliderRow
              label={t("pause_between_turns")}
              value={settings.pauseBetweenTurns}
              min={0.5} max={5.0} step={0.5}
              format={(v) => `${v.toFixed(1)}s`}
              onChange={(v) => update({ pauseBetweenTurns: v })}
            />
            <ToggleRow
              label={t("stop_on_consensus")}
              subtitle={t("stop_on_consensus_subtitle")}
              checked={settings.autoStopOnConsensus}
              onChange={(v) => update({ autoStopOnConsensus: v })}
            />
          </SettingsSection>

          {/* ── Moderator ──────────────────────────────────── */}
          <ModeratorSection
            participants={participants}
            selectedId={resolvedModeratorParticipantId}
            onSelect={(id) => update({ moderatorParticipantId: id })}
          />

          {/* ── Cost Estimate ──────────────────────────────── */}
          <CostSection totalTurns={totalTurns} cost={cost} warning={warning} />
        </div>

        {/* Start button */}
        <div className="px-5 py-4 border-t border-border/50 shrink-0">
          <button
            onClick={handleStart}
            disabled={!canStart}
            className="w-full py-3 rounded-xl bg-primary text-white font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t("start_discussion")}
          </button>
          {!hasMessages && (
            <p className="text-xs text-muted text-center mt-2">
              {t("send_first_message_topic")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SettingsSection({ title, footer, children }: {
  title: string; footer?: string; children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-medium text-muted uppercase tracking-wide">{title}</h3>
      <div className="space-y-4">{children}</div>
      {footer && <p className="text-xs text-muted">{footer}</p>}
    </section>
  );
}

function SliderRow({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-mono tabular-nums text-muted">{format(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 cursor-pointer accent-primary"
      />
    </div>
  );
}

function ToggleRow({ label, subtitle, checked, onChange }: {
  label: string; subtitle?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between px-1 py-1 rounded-lg hover:bg-surface-2 transition-colors"
    >
      <div className="text-left">
        <div className="text-sm font-medium">{label}</div>
        {subtitle && <div className="text-xs text-muted mt-0.5">{subtitle}</div>}
      </div>
      <div className={`w-10 h-6 rounded-full relative transition-colors ${checked ? "bg-primary" : "bg-surface-3"}`}>
        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
      </div>
    </button>
  );
}

function ModeratorSection({ participants, selectedId, onSelect }: {
  participants: Participant[]; selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium text-muted uppercase tracking-wide">{t("moderator")}</h3>
      <div className="space-y-1">
        {/* None option */}
        <ModeratorRow
          label={t("none")}
          isSelected={selectedId === null}
          onClick={() => onSelect(null)}
        />
        {participants.map((p, i) => (
          <ModeratorRow
            key={participantKey(p, i)}
            label={p.personaName ?? p.modelId.split("/").pop() ?? p.modelId}
            emoji={p.personaEmoji}
            isSelected={selectedId === participantKey(p, i)}
            onClick={() => onSelect(participantKey(p, i))}
          />
        ))}
      </div>
      <p className="text-xs text-muted">
        {t("moderator_guides_description")}
      </p>
    </section>
  );
}

function ModeratorRow({ label, emoji, isSelected, onClick }: {
  label: string; emoji?: string | null; isSelected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-surface-2 transition-colors"
    >
      {isSelected ? (
        <CircleCheck size={18} className="text-primary shrink-0" />
      ) : (
        <Circle size={18} className="text-muted shrink-0" />
      )}
      {emoji && <span className="text-base">{emoji}</span>}
      <span className="text-sm font-medium text-foreground truncate">{label}</span>
    </button>
  );
}

function CostSection({ totalTurns, cost, warning }: {
  totalTurns: number; cost: number; warning: CostWarningLevel;
}) {
  const { t } = useTranslation();
  return (
    <section className="rounded-xl bg-surface-2 border border-border/30 p-4">
      <h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-3">
        {t("cost_estimate")}
      </h3>
      <div className="flex items-start gap-3">
        <CostIcon warning={warning} />
        <div>
          <p className="text-sm">
            {t("cost_estimate_turns", { var1: totalTurns, var2: cost.toFixed(2) })}
          </p>
          <p className="text-xs text-muted mt-1">
            {t("cost_estimate_note")}
          </p>
        </div>
      </div>
    </section>
  );
}

function CostIcon({ warning }: { warning: CostWarningLevel }) {
  switch (warning) {
    case "low":
      return <CheckCircle size={20} className="text-green-500 shrink-0 mt-0.5" />;
    case "medium":
      return <AlertTriangle size={20} className="text-orange-500 shrink-0 mt-0.5" />;
    case "high":
      return <OctagonAlert size={20} className="text-red-500 shrink-0 mt-0.5" />;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function turnsFooter(t: TFunction, turnTakers: number, total: number): string {
  if (turnTakers === 1) {
    return t("each_cycle_1_participant_responds_once_num_total_turns", { var1: total });
  }
  return t("each_cycle_num_participants_respond_once_num_total_turns", { var1: turnTakers, var2: total });
}
