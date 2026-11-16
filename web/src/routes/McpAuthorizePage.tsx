import { useState } from "react";
import { useUser } from "@clerk/react";
import { useMutation, useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import { convexErrorMessage } from "@/lib/convexErrors";
import { MCP_SCOPE_DEPENDENCIES, selectedMcpScopes } from "@/lib/mcpScopes";


export function McpAuthorizePage() {
  const { t } = useTranslation();
  const { user } = useUser();
  const [params] = useSearchParams();
  const request = params.get("request") ?? "";
  const consent = useQuery(api.external_mcp.oauth.getConsent, { request });
  const authorize = useMutation(api.external_mcp.oauth.consent);
  // Scopes the user changed from their default (ticked, or unticked for opt-in scopes).
  const [toggled, setToggled] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function answer(allow: boolean) {
    if (!consent) return;
    setBusy(true); setError(undefined);
    try {
      const redirect = await authorize({ request, allow, scopes: selectedMcpScopes(consent.scopes, toggled) });
      window.location.assign(redirect);
    } catch (cause) { setError(convexErrorMessage(cause, t("something_went_wrong"))); setBusy(false); }
  }
  return <main className="min-h-screen flex items-center justify-center bg-background px-6" data-ph-block data-ph-mask>
    <section className="max-w-lg w-full rounded-2xl bg-surface-2 p-6 space-y-5">
      <h1 className="text-xl font-semibold">{t("external_mcp_connect")}</h1>
      <p>{user?.primaryEmailAddress?.emailAddress ?? user?.fullName}</p>
      {busy || consent === undefined ? <p role="status">{t("loading")}</p> : !consent ? <p role="alert">{t("external_mcp_restart")}</p> : <>
        <h2 className="text-xl font-semibold break-all">{consent.redirectHost}</h2>
        {!consent.isVerified && <div role="note" className="rounded-lg border border-border p-4 space-y-2">
          <p className="font-semibold">{t("external_mcp_unverified_app")}</p>
          <p>{t("external_mcp_unverified_warning")}</p>
        </div>}
        <p>{t("external_mcp_redirect_destination")} <strong className="break-all">{consent.redirectHost}</strong></p>
        <p className="break-all">{t("external_mcp_self_reported_name")} <bdi>{consent.name}</bdi></p>
        <p className="text-sm break-all">{consent.redirectUri}</p>
        <p>{t("external_mcp_choose_access")}</p>
        <fieldset disabled={busy} className="space-y-3">
          {consent.scopes.map(scope => {
            const selected = selectedMcpScopes(consent.scopes, toggled);
            const dependency = MCP_SCOPE_DEPENDENCIES[scope];
            const blocked = Boolean(dependency && !selected.includes(dependency));
            return <label key={scope} className={`flex items-start gap-3 ${blocked ? "opacity-50" : ""}`}>
              <input type="checkbox" disabled={blocked} checked={selected.includes(scope)} onChange={() => setToggled(current => current.includes(scope) ? current.filter(value => value !== scope) : [...current, scope])} />
              <span>{t(`external_mcp_scope_${scope.replace(":", "_")}`)}</span>
            </label>;
          })}
        </fieldset>
        <p className="text-sm text-muted">{t("external_mcp_connection_policy")}</p>
        <div className="flex gap-3">
          <button disabled={busy} onClick={() => void answer(true)} className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-50">{t("external_mcp_connect")}</button>
          <button disabled={busy} onClick={() => void answer(false)} className="rounded-lg border border-border px-4 py-2 disabled:opacity-50">{t("cancel")}</button>
        </div>
      </>}
      {error && <p role="alert">{error}</p>}
    </section>
  </main>;
}
