// components/chat/SearchSessionBadge.tsx
// Compact capsule indicator for terminal search session states (completed, failed, cancelled).
// Mirrors iOS SearchSessionBadge: colored pill with icon + label.

import { useTranslation } from "react-i18next";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { phaseLabelKey, type SearchSession, type SearchSessionStatus } from "@/hooks/useSearchSessions";
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

export function SearchSessionBadge({ session }: SearchSessionBadgeProps) {
  const { t } = useTranslation();
  const { Icon } = badgeConfig(session.status);
  const toneClass = statusTextClass(session.status);

  return (
    <div className={statusBadgeClass(session.status, "mt-2 border-0")}>
      <Icon size={12} className={toneClass} />
      <span className={`text-[11px] ${toneClass}`}>{t(phaseLabelKey(session.status, session.mode))}</span>
    </div>
  );
}
