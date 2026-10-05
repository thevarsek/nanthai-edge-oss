import { useState } from "react";
import { useMutation } from "convex/react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Laptop, Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { copyToClipboard } from "@/lib/clipboard";
import { convexErrorMessage } from "@/lib/convexErrors";
import type { RuntimePairingSession } from "@/lib/runtimePairingLink";
import { useRuntimeProAction } from "@/hooks/useRuntimeProAction";

export function RuntimePairingPanel() {
  const { t } = useTranslation();
  const begin = useMutation(api.runtime_host.pairing.beginPairing);
  const beginSetup = useMutation(api.runtime_host.activation.begin);
  const [session, setSession] = useState<RuntimePairingSession>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const command = session?.pairingCommand ?? (session ? `nanthai pair ${session.pairingId} ${session.oneTimeCode}` : "");
  const localPro = useRuntimeProAction({ kind: "local-runtime" }, { resume: () => void create(), promptOnEntry: true });

  async function create() {
    setBusy(true);
    setError(undefined);
    try { await beginSetup({}); setSession(await begin({ shortCode: true })); setCopied(false); }
    catch (cause) { setError(convexErrorMessage(cause, t("runtime_pairing_failed"))); }
    finally { setBusy(false); }
  }

  return <section className="rounded-2xl bg-surface-2 p-5 space-y-4">
    <div className="flex items-start gap-3">
      <Laptop size={20} className="text-primary" />
      <div><h2 className="font-semibold">{t("local_runtime_pair_heading")} · Pro</h2>
        <p className="text-sm text-muted mt-1">{t("runtime_pair_code_help")}</p></div>
    </div>
    {!localPro.isPro && <p className="text-sm text-secondary">{t("runtime_pro_purchase_help")}</p>}
    <button disabled={busy || localPro.loading || localPro.waiting} onClick={() => localPro.run(() => void create())} className="inline-flex gap-2 rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-50">
      {busy && <Loader2 size={15} className="animate-spin" />}{t("runtime_pair_code_create")}
    </button>
    {session && <div className="rounded-xl border border-border bg-background/40 p-4 space-y-3">
      <p className="text-xs text-muted">{t("local_runtime_pair_expires", { time: new Date(session.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) })}</p>
      <div className="flex gap-2 items-center">
        <code className="min-w-0 flex-1 select-all break-all text-lg tracking-wider">{session.pairingCode ?? command}</code>
        <button type="button" aria-label={t("copy")} title={t(copied ? "copied" : "copy")}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onClick={() => void copyToClipboard(session.pairingCode ?? command).then(() => setCopied(true))}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
      <details className="text-xs text-muted"><summary className="cursor-pointer">{t("runtime_advanced_cli")}</summary>
        <code className="block mt-2 break-all">{command}</code>
        <button className="mt-2 underline" onClick={() => void copyToClipboard(command)}>{t("copy")}</button>
        <p className="mt-2">{t("local_runtime_start_after_pairing")} <code>nanthai runtime start</code></p>
      </details>
    </div>}
    {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
    {localPro.status}
    {localPro.paywall}
  </section>;
}
