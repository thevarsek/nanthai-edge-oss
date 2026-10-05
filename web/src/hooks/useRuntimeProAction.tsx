import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { FunctionArgs } from "convex/server";
import { api } from "@convex/_generated/api";
import { PaywallModal } from "@/components/shared/PaywallModal";
import { useSharedData } from "./useSharedData";

/** Resume the user's requested action only after Convex confirms Pro. */
export function useRuntimeProAction(
  checkoutContext: NonNullable<FunctionArgs<typeof api.stripe.actions.createCheckoutSession>["checkoutContext"]>,
  { resume, promptOnEntry = false }: { resume?: () => void; promptOnEntry?: boolean } = {},
) {
  const { proStatus } = useSharedData();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const returned = params.get("pro") === "success";
  const cancelled = params.get("pro") === "cancelled";
  const isPro = proStatus?.isPro === true;
  const [showPaywall, setShowPaywall] = useState(promptOnEntry && !returned && !cancelled);
  const [waiting, setWaiting] = useState(returned && !!resume);
  const [restoreRequested, setRestoreRequested] = useState(false);
  const pending = useRef<(() => void) | undefined>(returned || (promptOnEntry && !isPro && !cancelled) ? resume : undefined);

  useEffect(() => {
    if (!isPro || !pending.current) return;
    const action = pending.current;
    pending.current = undefined;
    // The entitlement subscription completes a user-initiated purchase/restore.
    setShowPaywall(false);
    setWaiting(false);
    if (returned) setParams(previous => { const next = new URLSearchParams(previous); next.delete("pro"); return next; }, { replace: true });
    action();
  }, [isPro, returned, setParams]);

  function run(action: () => void) {
    if (isPro) { action(); return; }
    pending.current = action;
    setRestoreRequested(false);
    setShowPaywall(true);
  }
  function close() {
    pending.current = undefined;
    setShowPaywall(false);
    setWaiting(false);
    setRestoreRequested(false);
    if (returned) setParams(previous => { const next = new URLSearchParams(previous); next.delete("pro"); return next; }, { replace: true });
  }

  return {
    run,
    isPro,
    loading: proStatus === undefined,
    waiting: waiting && !isPro,
    paywall: showPaywall && proStatus !== undefined && !isPro
      ? <PaywallModal feature={t("local_runtime_title")} checkoutContext={checkoutContext} onClose={close}
          restoreHelp={restoreRequested ? t("runtime_pro_restore_help") : undefined}
          onRestore={() => setRestoreRequested(true)} /> : null,
    status: waiting && !isPro ? <div role="status" className="space-y-2 text-sm text-secondary">
      <p>{t("runtime_pro_confirming")}</p>
      <button type="button" className="underline" onClick={close}>{t("cancel")}</button>
    </div> : null,
  };
}
