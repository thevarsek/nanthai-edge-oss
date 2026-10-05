import { useState } from "react";
import { useUser } from "@clerk/react";
import { useMutation, useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import { convexErrorMessage } from "@/lib/convexErrors";


export function McpAuthorizePage() {
  const { t } = useTranslation();
  const { user } = useUser();
  const [params] = useSearchParams();
  const request = params.get("request") ?? "";
  const consent = useQuery(api.external_mcp.oauth.getConsent, { request });
  const authorize = useMutation(api.external_mcp.oauth.consent);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function answer(allow: boolean) {
    if (!consent) return;
    setBusy(true); setError(undefined);
    try {
      const redirect = await authorize({ request, allow, scopes: consent.scopes.filter(scope => !excluded.includes(scope)) });
      window.location.assign(redirect);
    } catch (cause) { setError(convexErrorMessage(cause, t("something_went_wrong"))); setBusy(false); }
  }
  return <main className="min-h-screen flex items-center justify-center bg-background px-6" data-ph-block data-ph-mask>
    <section className="max-w-lg w-full rounded-2xl bg-surface-2 p-6 space-y-5">
      <h1 className="text-xl font-semibold">{t("external_mcp_connect")}</h1>
      <p>{user?.primaryEmailAddress?.emailAddress ?? user?.fullName}</p>
      {busy || consent === undefined ? <p role="status">{t("loading")}</p> : !consent ? <p role="alert">{t("external_mcp_restart")}</p> : <>
        <h2 className="font-semibold">{consent.name}</h2>
        <p className="text-sm text-muted break-all">{consent.redirectUri}</p>
        <p>{t("external_mcp_choose_access")}</p>
        <fieldset disabled={busy} className="space-y-3">
          {consent.scopes.map(scope => <label key={scope} className="flex items-start gap-3">
            <input type="checkbox" checked={!excluded.includes(scope)} onChange={event => setExcluded(current => event.target.checked ? current.filter(value => value !== scope) : [...current, scope])} />
            <span>{t(`external_mcp_scope_${scope.replace(":", "_")}`)}</span>
          </label>)}
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
