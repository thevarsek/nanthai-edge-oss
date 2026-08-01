import { useState, type FormEvent } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export type RemoteMcpAuthMode = "none" | "bearer" | "api_key" | "oauth";

export interface RemoteMcpAddValues {
  endpoint: string;
  friendlyName?: string;
  authMode: RemoteMcpAuthMode;
  secret?: string;
  apiKeyHeader?: string;
}

export function RemoteMcpAddForm({
  isSaving,
  onCancel,
  onSubmit,
}: {
  isSaving: boolean;
  onCancel: () => void;
  onSubmit: (values: RemoteMcpAddValues) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [endpoint, setEndpoint] = useState("");
  const [friendlyName, setFriendlyName] = useState("");
  const [authMode, setAuthMode] = useState<RemoteMcpAuthMode>("none");
  const [secret, setSecret] = useState("");
  const [apiKeyHeader, setApiKeyHeader] = useState("x-api-key");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const usesStoredSecret = authMode === "bearer" || authMode === "api_key";
    await onSubmit({
      endpoint,
      friendlyName: friendlyName.trim() || undefined,
      authMode,
      secret: usesStoredSecret ? secret.trim() || undefined : undefined,
      apiKeyHeader: authMode === "api_key" ? apiKeyHeader : undefined,
    });
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="rounded-2xl border border-border bg-secondary p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">{t("remote_mcp_add_title")}</h2>
          <p className="mt-1 text-sm text-muted">
            {t("remote_mcp_add_description")}
            <span className="whitespace-nowrap"> (2026-07-28).</span>
          </p>
        </div>
        <button type="button" onClick={onCancel} className="p-2 rounded-lg hover:bg-surface-2" aria-label={t("remote_mcp_close_add_form")}>
          <X size={16} />
        </button>
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("remote_mcp_server_url")}</span>
        <input
          required
          type="url"
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
          placeholder="https://mcp.example.com/mcp"
          className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("remote_mcp_server_name")} <span className="text-muted font-normal">({t("optional")})</span></span>
        <input
          value={friendlyName}
          onChange={(event) => setFriendlyName(event.target.value)}
          maxLength={100}
          placeholder={t("remote_mcp_server_name_placeholder")}
          className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("remote_mcp_authentication")}</span>
        <select
          value={authMode}
          onChange={(event) => {
            const nextMode = event.target.value as RemoteMcpAuthMode;
            if (nextMode === "none" || nextMode === "oauth") setSecret("");
            setAuthMode(nextMode);
          }}
          className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
        >
          <option value="none">{t("remote_mcp_no_authentication")}</option>
          <option value="oauth">OAuth</option>
          <option value="bearer">{t("remote_mcp_bearer_token")}</option>
          <option value="api_key">{t("remote_mcp_api_key_header")}</option>
        </select>
      </label>
      {authMode === "api_key" && (
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("remote_mcp_api_key_header")}</span>
          <input
            required
            value={apiKeyHeader}
            onChange={(event) => setApiKeyHeader(event.target.value)}
            placeholder="x-api-key"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-mono"
          />
        </label>
      )}
      {(authMode === "bearer" || authMode === "api_key") && (
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("remote_mcp_credential")}</span>
          <input
            required
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
          />
          <span className="block text-xs text-muted">{t("remote_mcp_credential_security")}</span>
        </label>
      )}
      {authMode === "oauth" && (
        <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-xs text-muted">
          {t("remote_mcp_oauth_add_hint")}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2.5 text-sm hover:bg-surface-2">{t("cancel")}</button>
        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
          {t("remote_mcp_validate_server")}
        </button>
      </div>
    </form>
  );
}
