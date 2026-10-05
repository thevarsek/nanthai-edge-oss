import { useState } from "react";
import { useUser } from "@clerk/react";
import { useMutation } from "convex/react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import { convexErrorMessage } from "@/lib/convexErrors";
import { runtimePairingLink, type RuntimePairingSession } from "@/lib/runtimePairingLink";
import { useRuntimeProAction } from "@/hooks/useRuntimeProAction";

export function RuntimeConnectPage() {
  const { t } = useTranslation();
  const { user } = useUser();
  const [params] = useSearchParams();
  const state = params.get("state") ?? "";
  const computer = (params.get("computer") ?? "Mac").slice(0, 256);
  const begin = useMutation(api.runtime_host.pairing.beginPairing);
  const [handoff, setHandoff] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const valid = /^[a-zA-Z0-9-]{16,100}$/.test(state);
  const localPro = useRuntimeProAction({ kind: "runtime-connect", state, computer }, { resume: () => { if (valid) void connect(); } });

  async function connect() {
    setBusy(true);
    setError(undefined);
    try {
      const session = await begin({}) as RuntimePairingSession;
      setHandoff(runtimePairingLink(session, state));
    } catch (cause) { setError(convexErrorMessage(cause, t("runtime_pairing_failed"))); }
    finally { setBusy(false); }
  }

  return <main className="min-h-screen flex items-center justify-center bg-background px-6">
    <section className="max-w-lg w-full rounded-2xl bg-surface-2 p-6 space-y-5">
      <h1 className="text-xl font-semibold">{t("runtime_connect_heading")}</h1>
      <p className="text-secondary">{t("runtime_connect_description")}</p>
      <p className="text-sm text-secondary">{t("runtime_pro_purchase_help")}</p>
      <dl className="space-y-2">
        <div><dt className="text-sm text-muted">{t("runtime_connect_account")}</dt><dd>{user?.primaryEmailAddress?.emailAddress ?? user?.fullName}</dd></div>
        <div><dt className="text-sm text-muted">{t("runtime_connect_computer")}</dt><dd>{computer}</dd></div>
      </dl>
      {!valid ? <p role="alert">{t("runtime_connect_restart")}</p> : handoff ? <>
        <a href={handoff} className="inline-block rounded-lg bg-accent px-4 py-2 text-white">{t("runtime_connect_return")}</a>
        <p className="text-sm text-muted">{t("runtime_connect_return_help")}</p>
      </> : <button disabled={busy || localPro.loading || localPro.waiting} onClick={() => localPro.run(() => void connect())} className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-50">
        {t("runtime_connect_confirm")}
      </button>}
      {error && <p role="alert">{error}</p>}
      <Link className="block text-sm underline" to="/app/settings/local-runtime">{t("local_runtime_title")}</Link>
      <Link className="block text-sm underline" to="/onboarding?mode=connections">{t("runtime_choose_connection")}</Link>
      {localPro.status}
    </section>
    {localPro.paywall}
  </main>;
}
