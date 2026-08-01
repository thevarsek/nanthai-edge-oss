import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ChevronDown, ChevronUp, ExternalLink, Loader2, RefreshCw, Server, Trash2 } from "lucide-react";
import { remoteMcpErrorMessage } from "@/lib/remoteMcpErrors";
import { useTranslation } from "react-i18next";
import { RemoteMcpItemList, type RemoteMcpItem } from "./RemoteMcpItemList";

export interface RemoteMcpConnectionSummary {
  id: string;
  displayName: string;
  endpoint: string;
  endpointHost: string;
  friendlyName?: string;
  serverName?: string;
  status: string;
  authMode: string;
  protocolVersion?: string;
  itemCount: number;
  allowedItemCount: number;
  lastErrorCode?: string;
}

function statusClasses(status: string): string {
  if (status === "active") return "bg-green-500/15 text-green-600 dark:text-green-400";
  if (status === "unsupported" || status === "error") return "bg-red-500/15 text-red-600 dark:text-red-400";
  if (status === "auth_required" || status === "authorizing") return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-surface-3 text-muted";
}

export function RemoteMcpConnectionCard({ connection }: { connection: RemoteMcpConnectionSummary }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(connection.status !== "active");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [headerSecret, setHeaderSecret] = useState("");
  const [apiKeyHeader, setApiKeyHeader] = useState("x-api-key");
  const [friendlyName, setFriendlyName] = useState(connection.friendlyName ?? "");
  const detail = useQuery(api.mcp.queries.getConnection, expanded ? { connectionId: connection.id } : "skip");
  const setDecision = useMutation(api.mcp.mutations.setItemDecision);
  const setEnabled = useMutation(api.mcp.mutations.setConnectionEnabled);
  const setConnectionFriendlyName = useMutation(api.mcp.mutations.setConnectionFriendlyName);
  const disconnect = useAction(api.mcp.disconnect_action.disconnect);
  const refresh = useAction(api.mcp.actions.refreshCatalog);
  const invoke = useAction(api.mcp.actions.invoke);
  const respondToInput = useAction(api.mcp.continuation_actions.respondToInput);
  const startOAuth = useAction(api.mcp.oauth_actions.startOAuth);
  const updateTask = useAction(api.mcp.task_actions.updateTask);
  const replaceHeaderCredential = useAction(api.mcp.credential_actions.replaceHeaderCredential);

  async function run(label: string, operation: () => Promise<unknown>) {
    setBusy(label);
    setError(undefined);
    try {
      await operation();
    } catch (caught) {
      setError(remoteMcpErrorMessage(caught, t, t("remote_mcp_request_failed")));
    } finally {
      setBusy(undefined);
    }
  }

  async function authorize() {
    await run("oauth", async () => {
      const result = await startOAuth({
        connectionId: connection.id,
        issuer,
        clientId: clientId.trim() || undefined,
        clientSecret: clientSecret.trim() || undefined,
      });
      window.location.assign(result.authorizationUrl);
    });
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-secondary">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-3 p-4 text-left hover:bg-surface-2"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary"><Server size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{connection.displayName}</span>
          <span className="block truncate text-xs text-muted">{connection.endpointHost} · {t("remote_mcp_allowed_count", { allowed: connection.allowedItemCount, total: connection.itemCount })}</span>
        </span>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${statusClasses(connection.status)}`}>
          {t(`remote_mcp_status_${connection.status}`, { defaultValue: connection.status.replace("_", " ") })}
        </span>
        {expanded ? <ChevronUp size={15} className="text-muted" /> : <ChevronDown size={15} className="text-muted" />}
      </button>

      {expanded && (
        <div className="space-y-5 border-t border-border/50 p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="rounded-lg bg-surface-2 px-2 py-1">HTTPS</span>
            <span className="rounded-lg bg-surface-2 px-2 py-1">MCP {connection.protocolVersion ?? t("remote_mcp_protocol_required")}</span>
            <span className="rounded-lg bg-surface-2 px-2 py-1">{t(`remote_mcp_auth_${connection.authMode}`, { defaultValue: connection.authMode })}</span>
          </div>

          <div className="space-y-2 rounded-xl bg-surface-2 p-4">
            <div>
              <h3 className="text-sm font-semibold">{t("remote_mcp_server_name")}</h3>
              <p className="mt-1 text-xs text-muted">
                {t("remote_mcp_server_name_help", { name: connection.serverName || connection.endpointHost })}
              </p>
            </div>
            <div className="flex gap-2">
              <input
                value={friendlyName}
                onChange={(event) => setFriendlyName(event.target.value)}
                maxLength={100}
                placeholder={connection.serverName || connection.endpointHost}
                aria-label={t("remote_mcp_server_name")}
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={busy === "name" || friendlyName.trim() === (connection.friendlyName ?? "")}
                onClick={() => void run("name", () => setConnectionFriendlyName({
                  connectionId: connection.id,
                  ...(friendlyName.trim() ? { friendlyName: friendlyName.trim() } : {}),
                }))}
                className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-surface-3 disabled:opacity-50"
              >
                {t("remote_mcp_save_name")}
              </button>
            </div>
          </div>

          {connection.authMode === "oauth" && ["auth_required", "error"].includes(connection.status) && (
            <div className="space-y-3 rounded-xl bg-surface-2 p-4">
              <div>
                <h3 className="text-sm font-semibold">{t("remote_mcp_authorize_oauth")}</h3>
                <p className="mt-1 text-xs text-muted">
                  {t("remote_mcp_oauth_discovery_help")}
                </p>
              </div>
              <input
                type="url"
                value={issuer}
                onChange={(event) => setIssuer(event.target.value)}
                placeholder={t("remote_mcp_oauth_issuer_placeholder")}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder={t("remote_mcp_client_id_placeholder")} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
                <input type="password" autoComplete="off" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder={t("remote_mcp_client_secret_placeholder")} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
              </div>
              <button
                type="button"
                disabled={busy === "oauth"}
                onClick={() => void authorize()}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {busy === "oauth" ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
                {t("remote_mcp_continue_authorization")}
              </button>
            </div>
          )}

          {(connection.authMode === "bearer" || connection.authMode === "api_key")
            && ["auth_required", "error"].includes(connection.status) && (
            <div className="space-y-3 rounded-xl bg-surface-2 p-4">
              <div>
                <h3 className="text-sm font-semibold">{t("remote_mcp_update_credential")}</h3>
                <p className="mt-1 text-xs text-muted">{t("remote_mcp_update_credential_help")}</p>
              </div>
              {connection.authMode === "api_key" && (
                <input
                  value={apiKeyHeader}
                  onChange={(event) => setApiKeyHeader(event.target.value)}
                  placeholder="x-api-key"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm"
                />
              )}
              <input
                type="password"
                autoComplete="off"
                value={headerSecret}
                onChange={(event) => setHeaderSecret(event.target.value)}
                placeholder={connection.authMode === "bearer" ? t("remote_mcp_bearer_token") : t("remote_mcp_api_key")}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={!headerSecret.trim() || busy === "credential"}
                onClick={() => void run("credential", async () => {
                  await replaceHeaderCredential({
                    connectionId: connection.id,
                    secret: headerSecret,
                    apiKeyHeader: connection.authMode === "api_key" ? apiKeyHeader : undefined,
                  });
                  setHeaderSecret("");
                })}
                className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {t("remote_mcp_save_and_validate")}
              </button>
            </div>
          )}

          {connection.lastErrorCode && (
            <p className="rounded-xl bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
              {connection.lastErrorCode === "MCP_UNSUPPORTED_SERVER"
                ? t("remote_mcp_unsupported_server")
                : t("remote_mcp_connection_diagnostic", { code: connection.lastErrorCode })}
            </p>
          )}
          {error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">{error}</p>}

          {detail === undefined && <div className="flex justify-center py-6"><Loader2 className="animate-spin text-muted" size={18} /></div>}
          {detail?.items && detail.items.length > 0 && (
            <RemoteMcpItemList
              items={detail.items as RemoteMcpItem[]}
              onDecision={async (stableKey, decision) => {
                await setDecision({ connectionId: connection.id, stableKey, decision });
              }}
              onInvoke={async (item, values) => await invoke({
                connectionId: connection.id,
                stableKey: item.stableKey,
                kind: item.kind,
                arguments: values.arguments,
                uri: values.uri,
                requestState: values.requestState,
                inputResponses: values.inputResponses,
              })}
              onResume={async (invocationId, inputResponses) => await respondToInput({
                invocationId,
                inputResponses,
              })}
              onTask={async (invocationId, operation, inputResponses) => await updateTask({
                invocationId,
                operation,
                inputResponses,
              })}
            />
          )}

          <div className="flex flex-wrap gap-2 border-t border-border/50 pt-4">
            {connection.protocolVersion && (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void run("enabled", () => setEnabled({ connectionId: connection.id, enabled: connection.status !== "active" }))}
                className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {connection.status === "active" ? t("remote_mcp_disable_server") : t("remote_mcp_enable_server")}
              </button>
            )}
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void run("refresh", () => refresh({ connectionId: connection.id }))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:bg-surface-2 disabled:opacity-60"
            >
              <RefreshCw size={13} className={busy === "refresh" ? "animate-spin" : ""} /> {t("remote_mcp_refresh_catalog")}
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void run("disconnect", () => disconnect({ connectionId: connection.id }))}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-red-500 hover:bg-red-500/10 disabled:opacity-60"
            >
              <Trash2 size={13} /> {t("disconnect")}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
