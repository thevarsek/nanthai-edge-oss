import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ChevronLeft, Plus, Server } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ProGateWrapper } from "@/hooks/useProGate";
import { remoteMcpErrorMessage } from "@/lib/remoteMcpErrors";
import { RemoteMcpAddForm, type RemoteMcpAddValues } from "@/components/settings/RemoteMcpAddForm";
import {
  RemoteMcpConnectionCard,
  type RemoteMcpConnectionSummary,
} from "@/components/settings/RemoteMcpConnectionCard";

function RemoteMcpContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const connections = useQuery(api.mcp.queries.listConnections, {});
  const addServer = useAction(api.mcp.actions.addServer);
  const [showAdd, setShowAdd] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function create(values: RemoteMcpAddValues) {
    setIsSaving(true);
    setError(undefined);
    try {
      await addServer(values);
      setShowAdd(false);
    } catch (caught) {
      setError(remoteMcpErrorMessage(caught, t, t("remote_mcp_add_failed")));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-border/50 p-4">
        <button type="button" onClick={() => navigate("/app/settings")} className="rounded-lg p-1.5 hover:bg-surface-2" aria-label={t("back_to_settings")}>
          <ChevronLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">{t("remote_mcp_servers")}</h1>
          <p className="text-xs text-muted">{t("remote_mcp_settings_subtitle")}</p>
        </div>
        {!showAdd && (
          <button type="button" onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white">
            <Plus size={15} /> {t("remote_mcp_add_server")}
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="mx-auto max-w-3xl space-y-4 pb-10">
          <div className="rounded-2xl bg-primary/8 p-4 text-sm text-muted">
            {t("remote_mcp_compatibility_notice_before")}
            <span className="whitespace-nowrap"> (2026-07-28).</span> {t("remote_mcp_compatibility_notice_after")}
          </div>
          {showAdd && <RemoteMcpAddForm isSaving={isSaving} onCancel={() => setShowAdd(false)} onSubmit={create} />}
          {error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          {connections === undefined && <div className="py-10 text-center text-sm text-muted">{t("remote_mcp_loading_servers")}</div>}
          {connections?.map((connection) => (
            <RemoteMcpConnectionCard key={connection.id} connection={connection as RemoteMcpConnectionSummary} />
          ))}
          {connections?.length === 0 && !showAdd && (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center">
              <Server size={28} className="mx-auto text-muted" />
              <h2 className="mt-3 font-semibold">{t("remote_mcp_no_servers")}</h2>
              <p className="mt-1 text-sm text-muted">{t("remote_mcp_no_servers_description")}</p>
              <button type="button" onClick={() => setShowAdd(true)} className="mt-4 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white">{t("remote_mcp_add_server")}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function RemoteMcpPage() {
  return (
    <ProGateWrapper featureId="integrations" presentation="page">
      <RemoteMcpContent />
    </ProGateWrapper>
  );
}
