import { Check, FileText, ServerCog, TerminalSquare } from "lucide-react";
import { IconSlot, MockPanel } from "./IllustrationPrimitives";
import { useTranslation } from "react-i18next";

export function RemoteMcpIllustration() {
  const { t } = useTranslation();
  const items = [
    { icon: TerminalSquare, label: t("mcp_illustration_search_docs"), kind: t("remote_mcp_kind_tool") },
    { icon: FileText, label: t("mcp_illustration_workers_prompt"), kind: t("remote_mcp_kind_prompt") },
    { icon: FileText, label: t("mcp_illustration_api_reference"), kind: t("remote_mcp_kind_resource") },
  ];
  return (
    <MockPanel showDots title={t("remote_mcp_server_singular")} className="mx-auto max-w-md">
      <div className="rounded-xl border border-[rgba(var(--edge-fg),0.08)] bg-[rgba(var(--edge-fg),0.02)] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(var(--edge-fg),0.05)] text-[var(--edge-cyan)]">
            <IconSlot icon={ServerCog} size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold efg-70">{t("mcp_illustration_cloudflare_docs")}</p>
            <p className="mt-0.5 text-[9px] efg-30">HTTPS · MCP 2026-07-28 · OAuth</p>
          </div>
          <span className="rounded-full bg-[rgba(16,185,129,0.10)] px-2 py-1 text-[9px] font-medium text-emerald-500">
            {t("connected")}
          </span>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {items.map(({ icon, label, kind }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-xl border border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.02)] px-3.5 py-3"
          >
            <IconSlot icon={icon} size={14} className="efg-35" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-medium efg-60">{label}</p>
              <p className="mt-0.5 text-[8px] uppercase tracking-wider efg-25">{kind}</p>
            </div>
            <div className="flex items-center gap-1 text-[9px] font-medium text-emerald-500">
              <IconSlot icon={Check} size={10} /> {t("remote_mcp_allowed")}
            </div>
          </div>
        ))}
      </div>
    </MockPanel>
  );
}
