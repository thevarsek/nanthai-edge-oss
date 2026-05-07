// components/chat/SearchSessionBadge.tsx
// Compact capsule indicator for terminal search session states (completed, failed, cancelled).
// Mirrors iOS SearchSessionBadge: colored pill with icon + label.

import { useTranslation } from "react-i18next";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { SearchSession, SearchSessionStatus } from "@/hooks/useSearchSessions";
import { statusBadgeClass, statusTextClass } from "@/lib/uiTokens";

// ─── Badge config per status ──────────────────────────────────────────────────

function badgeConfig(status: SearchSessionStatus) {
  switch (status) {
    case "completed":
      return { Icon: CheckCircle2 };
    case "failed":
      return { Icon: AlertTriangle };
    case "cancelled":
      return { Icon: XCircle };
    default:
      return { Icon: CheckCircle2 };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SearchSessionBadgeProps {
  session: SearchSession;
}

const PHASE_LABEL_KEYS: Record<SearchSessionStatus, string> = {
  planning: "search_phase_planning",
  searching: "search_phase_searching",
  analyzing: "search_phase_analyzing",
  deepening: "search_phase_deepening",
  synthesizing: "search_phase_synthesizing",
  writing: "search_phase_writing",
  completed: "search_phase_completed",
  failed: "search_phase_failed",
  cancelled: "search_phase_cancelled",
};

export function SearchSessionBadge({ session }: SearchSessionBadgeProps) {
  const { t } = useTranslation();
  const { Icon } = badgeConfig(session.status);
  const toneClass = statusTextClass(session.status);

  return (
    <div className={statusBadgeClass(session.status, "mt-2 border-0")}>
      <Icon size={12} className={toneClass} />
      <span className={`text-[11px] ${toneClass}`}>{t(PHASE_LABEL_KEYS[session.status])}</span>
    </div>
  );
}
