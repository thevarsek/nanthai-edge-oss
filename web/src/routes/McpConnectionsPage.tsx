import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { convexErrorMessage } from "@/lib/convexErrors";

export function McpConnectionsPage() {
  const { t } = useTranslation();
  const connections = useQuery(api.external_mcp.oauth.listMyConnections, {});
  const revoke = useMutation(api.external_mcp.oauth.revoke);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const endpoint = `${String(import.meta.env.VITE_CONVEX_URL).replace(/\.cloud\/?$/, ".site")}/mcp`;
  async function disconnect(grantId: Id<"externalMcpGrants">) {
    setBusy(grantId); setError(undefined);
    try { await revoke({ grantId }); }
    catch (cause) { setError(convexErrorMessage(cause, t("something_went_wrong"))); }
    finally { setBusy(undefined); }
  }
  return <main className="mx-auto max-w-3xl space-y-5 p-6">
    <Link to="/app/settings">← {t("settings")}</Link>
    <h1 className="text-xl font-semibold">{t("external_mcp_title")}</h1>
    <p>{t("external_mcp_setup")}</p>
    <code className="block select-all break-all rounded-xl bg-surface-2 p-4">{endpoint}</code>
    <p className="text-sm text-muted">{t("external_mcp_connection_policy")}</p>
    {connections === undefined ? <p role="status">{t("loading")}</p> : !connections.length ? <p>{t("external_mcp_empty")}</p> : connections.map(connection => <section key={connection.id} className="rounded-xl bg-surface-2 p-4 space-y-3">
      <h2 className="font-semibold">{connection.name}</h2>
      <ul>{connection.scopes.map(scope => <li key={scope}>{t(`external_mcp_scope_${scope.replace(":", "_")}`)}</li>)}</ul>
      <button disabled={busy !== undefined} onClick={() => void disconnect(connection.id)} className="text-destructive disabled:opacity-50">{t("external_mcp_revoke")}</button>
    </section>)}
    {error && <p role="alert">{error}</p>}
  </main>;
}
