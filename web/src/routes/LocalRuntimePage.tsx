import { RuntimeQuestionSettings } from "./RuntimeQuestionSettings";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { RuntimeDeviceCard, type RuntimeDevice } from "./LocalRuntimeDeviceCard";
import { RuntimeSetupGuide } from "./RuntimeSetupGuide";
import { useSharedData } from "@/hooks/useSharedData";
import { RuntimePairingPanel } from "./RuntimePairingPanel";
import { convexErrorMessage } from "@/lib/convexErrors";

export function LocalRuntimePage() {
  const { t } = useTranslation();
  const { prefs } = useSharedData();
  const devices = useQuery(api.runtime_host.devices.listMyDevices, {}) as RuntimeDevice[] | undefined;
  const revokeDevice = useMutation(api.runtime_host.pairing.revokeDevice);
  const hideDevice = useMutation(api.runtime_host.devices.hideRemovedDevice);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handleRevoke = async (device: RuntimeDevice) => {
    setRevokingId(device.deviceId);
    setError(null);
    try {
      await revokeDevice({
        runtimeDeviceId: device.runtimeDeviceId,
        reason: "Removed from NanthAI settings",
      });
    } catch (cause) {
      setError(convexErrorMessage(cause, t("runtime_remove_failed")));
    } finally {
      setRevokingId(null);
    }
  };

  const handleHide = async (device: RuntimeDevice) => {
    setRevokingId(device.deviceId);
    setError(null);
    try { await hideDevice({ runtimeDeviceId: device.runtimeDeviceId }); }
    catch (cause) { setError(convexErrorMessage(cause, t("runtime_remove_failed"))); }
    finally { setRevokingId(null); }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <header className="flex items-center gap-3 p-4 border-b border-border/50">
        <Link
          to="/app/settings"
          aria-label={t("back_to_settings")}
          className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
        >
          <ChevronLeft size={18} />
        </Link>
        <h1 className="text-lg font-semibold">{t("local_runtime_title")}</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="max-w-4xl mx-auto space-y-6 pb-10">
          <RuntimeSetupGuide />
          <RuntimeQuestionSettings />
          <p className="text-sm text-secondary">{t(prefs?.runtimeOnboardingState === "ready" ? "runtime_preview_activation_complete" : "runtime_preview_activation_proof")}</p>
          <Link to="/onboarding?mode=connections" className="inline-block text-primary underline underline-offset-4">{t("runtime_choose_connection")}</Link>
          <RuntimePairingPanel />

          {error && (
            <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <section className="space-y-2">
            <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted">
              {t("local_runtime_paired_machines")}
            </h2>
            {devices === undefined ? (
              <div className="flex justify-center rounded-2xl bg-surface-2 p-8">
                <Loader2 aria-label={t("loading")} size={20} className="animate-spin text-muted" />
              </div>
            ) : devices.length === 0 ? (
              <div className="rounded-2xl bg-surface-2 px-4 py-8 text-center">
                <p className="text-sm font-medium">{t("local_runtime_no_machines")}</p>
                <p className="text-xs text-muted mt-1">{t("local_runtime_no_machines_help")}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {devices.map((device) => (
                  <RuntimeDeviceCard
                    key={device.deviceId}
                    device={device}
                    isRevoking={revokingId === device.deviceId}
                    onRevoke={() => void handleRevoke(device)}
                    onHide={() => void handleHide(device)}
                    onError={setError}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
