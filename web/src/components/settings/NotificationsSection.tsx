import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Check, Bell } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Toggle } from "@/components/shared/Toggle";
import { ProBadge } from "@/components/shared/ProBadge";
import { useProGate } from "@/hooks/useProGate.hook";
import { useSharedData } from "@/hooks/useSharedData";
import { useWebPush } from "@/hooks/useWebPush";

// ─── Local notification prefs (device-specific, stored in localStorage) ────

interface NotifPrefs {
  jobCompletions: boolean;
  researchCompletions: boolean;
  creditAlerts: boolean;
}

const STORAGE_KEY = "nanth_notification_prefs";
const DEFAULTS: NotifPrefs = { jobCompletions: true, researchCompletions: true, creditAlerts: true };

function loadNotifPrefs(): NotifPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function saveNotifPrefs(prefs: NotifPrefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

// ─── Component ─────────────────────────────────────────────────────────────

export function NotificationsSection() {
  const { t } = useTranslation();
  const { prefs: sharedPrefs } = useSharedData();
  const [pushStatus, setPushStatus] = useState<
    "idle" | "requesting"
  >("idle");
  const [prefs, setPrefs] = useState<NotifPrefs>(() => loadNotifPrefs());
  const [pendingChatCompletionEnabled, setPendingChatCompletionEnabled] = useState<boolean | null>(null);
  const { isPro } = useProGate();
  const upsertPreferences = useMutation(api.preferences.mutations.upsertPreferences);
  const webPush = useWebPush();

  const notificationsDenied =
    webPush.status === "denied" ||
    (typeof Notification !== "undefined" && Notification.permission === "denied");
  const isEnabled = webPush.isRegistered;
  const serverChatCompletionEnabled = sharedPrefs?.chatCompletionNotificationsEnabled ?? false;
  const chatCompletionNotificationsEnabled =
    pendingChatCompletionEnabled ?? serverChatCompletionEnabled;

  useEffect(() => {
    if (pendingChatCompletionEnabled === serverChatCompletionEnabled) {
      // Clear optimistic state once the reactive server preference catches up.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingChatCompletionEnabled(null);
    }
  }, [pendingChatCompletionEnabled, serverChatCompletionEnabled]);

  const handleEnablePush = async () => {
    setPushStatus("requesting");
    await webPush.enable();
    setPushStatus("idle");
  };

  const handleDisablePush = async () => {
    await webPush.disable();
    setPushStatus("idle");
  };

  const togglePref = useCallback((key: keyof NotifPrefs) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveNotifPrefs(next);
      return next;
    });
  }, []);

  const handleChatCompletionToggle = useCallback((nextValue: boolean) => {
    setPendingChatCompletionEnabled(nextValue);
    void (async () => {
      try {
        await upsertPreferences({
          chatCompletionNotificationsEnabled: nextValue,
        });
      } catch {
        setPendingChatCompletionEnabled(null);
      }
    })();
  }, [upsertPreferences]);

  return (
    <div className="space-y-4">
      {/* Push permission status */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-foreground/50 uppercase tracking-wide px-1">
          {t("push_notifications")}
        </h3>
        <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
          {isEnabled ? (
            <div className="flex items-center gap-3 px-4 py-3 justify-between">
              <div className="flex items-center gap-3 min-w-0">
              <Check size={16} className="text-green-400 flex-shrink-0" />
              <p className="text-sm text-green-400">{t("notifications_enabled")}</p>
              </div>
              <button onClick={handleDisablePush} className="text-xs text-foreground/60 hover:text-foreground transition-colors">
                {t("disable")}
              </button>
            </div>
          ) : notificationsDenied ? (
            <div className="px-4 py-3 space-y-1">
              <p className="text-sm text-red-400">{t("notifications_blocked")}</p>
              <p className="text-xs text-foreground/50">
                {t("notifications_blocked_instructions")}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <button
                onClick={handleEnablePush}
                disabled={pushStatus === "requesting" || !webPush.isSupported || !webPush.isConfigured}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left disabled:opacity-50"
              >
                <Bell size={16} className="flex-shrink-0" />
                <span className="text-sm">
                  {!webPush.isSupported
                    ? t("push_not_supported")
                    : !webPush.isConfigured
                      ? "Push notifications are not configured"
                      : pushStatus === "requesting"
                        ? t("requesting")
                        : webPush.status === "error"
                          ? t("retry")
                          : t("enable_push_notifications")}
                </span>
              </button>
              {webPush.status === "error" && (
                <p className="px-4 pb-3 text-xs text-red-400">{webPush.errorMessage ?? t("something_went_wrong")}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Per-category toggles */}
      {isEnabled && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-foreground/50 uppercase tracking-wide px-1">
            {t("category")}
          </h3>
          <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
            {/* Job Completions — Pro gated */}
            <div className={`flex items-center justify-between px-4 py-3${!isPro ? " opacity-50" : ""}`}>
              <div className="flex items-center gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm">{t("scheduled_job_completions")}</p>
                    {!isPro && <ProBadge size="sm" />}
                  </div>
                  <p className="text-xs text-foreground/50 mt-0.5">{t("scheduled_jobs_finish_running")}</p>
                </div>
              </div>
              <Toggle checked={isPro && prefs.jobCompletions} onChange={() => { if (isPro) togglePref("jobCompletions"); }} disabled={!isPro} />
            </div>
            {/* Research Completions — Pro gated */}
            <div className={`flex items-center justify-between px-4 py-3${!isPro ? " opacity-50" : ""}`}>
              <div className="flex items-center gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm">{t("research_completions")}</p>
                    {!isPro && <ProBadge size="sm" />}
                  </div>
                  <p className="text-xs text-foreground/50 mt-0.5">{t("deep_research_tasks_complete")}</p>
                </div>
              </div>
              <Toggle checked={isPro && prefs.researchCompletions} onChange={() => { if (isPro) togglePref("researchCompletions"); }} disabled={!isPro} />
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm">{t("chat_reply_completions")}</p>
                <p className="text-xs text-foreground/50 mt-0.5">{t("chat_reply_completions_when_out_of_focus")}</p>
              </div>
              <Toggle
                checked={isEnabled && chatCompletionNotificationsEnabled}
                onChange={() => handleChatCompletionToggle(!chatCompletionNotificationsEnabled)}
              />
            </div>
            {/* Credit Balance Alerts */}
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm">{t("credit_balance_alerts")}</p>
                <p className="text-xs text-foreground/50 mt-0.5">{t("openrouter_balance_drops_below_threshold")}</p>
              </div>
              <Toggle checked={prefs.creditAlerts} onChange={() => togglePref("creditAlerts")} />
            </div>
          </div>
        </div>
      )}

      {/* When denied: instructional text (browsers don't allow programmatic settings navigation) */}
      {notificationsDenied && (
        <div className="rounded-2xl bg-surface-2 px-4 py-3 space-y-1.5">
          <p className="text-xs font-medium text-secondary">{t("how_to_reenable_notifications")}</p>
          <ol className="text-xs text-foreground/50 space-y-1 list-decimal pl-4">
            <li>{t("notifications_reenable_step1")}</li>
            <li>{t("notifications_reenable_step2")}</li>
            <li>{t("notifications_reenable_step3")}</li>
          </ol>
        </div>
      )}

      {/* Footer — matches iOS: "$1.00, $0.50, or $0.10" thresholds */}
      <p className="text-xs text-foreground/50 px-1">
        {t("control_which_notifications_footer")}
      </p>
    </div>
  );
}
