import { useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Laptop, Send } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@convex/_generated/api";
import { useOpenRouterStatus, useCreditBalance, formatUsd } from "@/hooks/useSharedData";
import { ProviderLogo } from "@/components/shared/ProviderLogo";
import { SettingsSection } from "./SettingsHelpers";

export function AIConnectionsSection({ onOpenRouter, onTelegram }: { onOpenRouter: () => void; onTelegram?: () => void }) {
  const { t } = useTranslation();
  const connected = useOpenRouterStatus();
  const { balance, loading } = useCreditBalance();
  const local = useQuery(api.runtime_host.connection_summary.getMySummary, {});
  const telegram = useQuery(api.channels.linking.status, {});
  const rowClass = "flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-surface-3 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
  return <SettingsSection header={t("ai_connections")}>
    <button type="button" onClick={onOpenRouter} className={rowClass}>
      <ProviderLogo modelId="openrouter/auto" size={24} />
      <span className="flex-1 min-w-0"><span className="block text-sm font-medium">OpenRouter</span>
        <span className="block text-xs text-muted mt-1">{t(connected === undefined ? "loading" : connected ? "connected" : "not_connected")}</span></span>
      {connected && <span className="text-sm tabular-nums">{balance !== null ? formatUsd(balance) : loading ? t("loading") : t("credits")}</span>}
      <ChevronRight size={16} className="text-muted shrink-0" />
    </button>
    <Link to="/app/settings/local-runtime" className={rowClass}>
      <Laptop size={24} className="text-primary shrink-0" />
      <span className="flex-1 min-w-0"><span className="block text-sm font-medium">{t("local_runtime_title")} · Pro</span>
        <span className="block text-xs text-muted mt-1">{t(local ? `ai_connection_${local.status}` : "loading")}{local?.deviceName ? ` · ${local.deviceName}` : ""}</span></span>
      <ChevronRight size={16} className="text-muted shrink-0" />
    </Link>
    <button type="button" onClick={onTelegram} className={rowClass}>
      <Send size={24} className="text-primary shrink-0" />
      <span className="flex-1 min-w-0"><span className="block text-sm font-medium">Telegram</span>
        <span className="block text-xs text-muted mt-1">{t(telegram?.connectionState ? `tg_status_${telegram.connectionState}` : "loading")}{telegram?.connectedChatTitle ? ` · ${telegram.connectedChatTitle}` : ""}</span></span>
      <ChevronRight size={16} className="text-muted shrink-0" />
    </button>
  </SettingsSection>;
}
