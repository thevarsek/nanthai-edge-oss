import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight, ChevronUp, ChevronDown, Plus, Minus, Check,
  Brain,
} from "lucide-react";
import { useConnectedAccounts } from "@/hooks/useSharedData";
import { Toggle } from "@/components/shared/Toggle";
import { ChatKBPicker } from "@/components/chat/ChatKBPicker";
import { useToast } from "@/components/shared/Toast.context";
import { connectProviderWithPopup } from "@/lib/providerOAuth";
import { convexErrorMessage } from "@/lib/convexErrors";
import type { RemoteMcpConnectionOption } from "@/lib/remoteMcp";
import { IntegrationRow } from "./PersonaEditorHelpers";
import {
  type DraftStep,
  type RecurrenceType,
  type SearchMode,
} from "@/routes/ScheduledJobEditor.model";
import {
  localWeeklyRecurrenceToUtc,
  isValidRecurrenceTime,
  parseLocalTimeInput,
  utcWeeklyRecurrenceToLocal,
} from "./ScheduledJobEditorRecurrence";

// ─── Section Header / Footer ────────────────────────────────────────────────

export function SH({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium text-muted uppercase tracking-wide px-1 pt-3 first:pt-0">
      {children}
    </h3>
  );
}

export function SF({ children, error }: { children?: React.ReactNode; error?: boolean }) {
  return (
    <p className={`text-xs px-1 ${error ? "text-red-400" : "text-muted"}`}>{children}</p>
  );
}

// ─── Step List Section ──────────────────────────────────────────────────────

export function StepListSection({
  steps, selectedIdx, onSelect, onAdd, onMoveUp, onMoveDown, onRemove,
}: {
  steps: DraftStep[];
  selectedIdx: number;
  onSelect: (i: number) => void;
  onAdd: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <SH>{t("steps_section")}</SH>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        {steps.map((step, idx) => (
          <button
            key={step.id}
            onClick={() => onSelect(idx)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
          >
            <div className={`w-5 h-5 rounded-full flex items-center justify-center ${idx === selectedIdx ? "bg-primary text-white" : "border border-foreground/20"}`}>
              {idx === selectedIdx && <Check size={12} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {step.title.trim() || `Step ${idx + 1}`}
              </p>
              <p className="text-xs text-muted truncate">
                {step.prompt.trim() || t("no_prompt_yet")}
              </p>
            </div>
          </button>
        ))}
        {steps.length < 5 && (
          <button
            onClick={onAdd}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
          >
            <Plus size={16} className="text-primary" />
            <span className="text-sm text-primary">{t("add_step")}</span>
          </button>
        )}
      </div>
      {steps.length > 1 && (
        <div className="flex items-center gap-2 px-1">
          <button
            onClick={onMoveUp}
            disabled={selectedIdx === 0}
            className="flex items-center gap-1 text-xs text-primary disabled:text-muted disabled:cursor-not-allowed"
          >
            <ChevronUp size={12} /> {t("move_up")}
          </button>
          <button
            onClick={onMoveDown}
            disabled={selectedIdx >= steps.length - 1}
            className="flex items-center gap-1 text-xs text-primary disabled:text-muted disabled:cursor-not-allowed"
          >
            <ChevronDown size={12} /> {t("move_down")}
          </button>
          <div className="flex-1" />
          <button
            onClick={onRemove}
            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
          >
            <Minus size={12} /> {t("remove_step")}
          </button>
        </div>
      )}
      <SF>{t("steps_footer")}</SF>
    </div>
  );
}

// ─── Step Task Section ──────────────────────────────────────────────────────

export function StepTaskSection({
  step, onChange,
}: {
  step: DraftStep;
  onChange: (patch: Partial<DraftStep>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <SH>{t("selected_step")}</SH>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        <div className="px-4 py-3">
          <input
            value={step.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder={t("step_title_placeholder")}
            className="w-full text-sm bg-transparent placeholder:text-muted focus:outline-none"
          />
        </div>
        <div className="px-4 py-3">
          <textarea
            value={step.prompt}
            onChange={(e) => onChange({ prompt: e.target.value })}
            placeholder={t("step_prompt_placeholder")}
            rows={4}
            className="w-full text-sm bg-transparent placeholder:text-muted focus:outline-none resize-none"
          />
        </div>
      </div>
    </div>
  );
}

export { StepParticipantSection } from "./ScheduledJobStepParticipant";

// ─── Integrations Section ───────────────────────────────────────────────────

export function StepIntegrationsSection({
  step, remoteMcpConnections = [], onChange,
}: {
  step: DraftStep;
  remoteMcpConnections?: RemoteMcpConnectionOption[];
  onChange: (patch: Partial<DraftStep>) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { googleConnection, gmailManualConnection, microsoftConnection, appleCalendarConnection, notionConnection, clozeConnection, slackConnection } = useConnectedAccounts();
  const hasGmail = gmailManualConnection?.status === "active";
  const hasGoogleConnection = !!googleConnection;
  const hasMicrosoft = !!microsoftConnection;
  const hasApple = !!appleCalendarConnection;
  const hasNotion = !!notionConnection;
  const hasCloze = clozeConnection?.status === "active";
  const hasSlack = !!slackConnection;
  const handleGoogleToggle = async (
    checked: boolean,
    integrationId: "gmail" | "drive" | "calendar",
    patch: Partial<DraftStep>,
  ) => {
    if (!checked) {
      onChange(patch);
      return;
    }

    if (integrationId === "gmail") {
      if (!hasGmail) {
        toast({
          message: t("connect_gmail_app_password_first"),
          variant: "error",
        });
        return;
      }
      onChange(patch);
      return;
    }

    const capabilityGranted =
      (integrationId === "drive" && googleConnection?.hasDrive) ||
      (integrationId === "calendar" && googleConnection?.hasCalendar);

    if (!capabilityGranted) {
      try {
        await connectProviderWithPopup("google", { requestedIntegration: integrationId });
      } catch (error) {
        toast({
          message: convexErrorMessage(error, t("google_signin_failed")),
          variant: "error",
        });
        return;
      }
    }

    onChange(patch);
  };
  const integrationRows = [
    {
      slug: "gmail",
      label: t("integration_gmail"),
      checked: step.gmailEnabled,
      available: hasGmail,
      onChange: (v: boolean) => { void handleGoogleToggle(v, "gmail", { gmailEnabled: v }); },
    },
    {
      slug: "google-drive",
      label: t("integration_google_drive"),
      checked: step.driveEnabled,
      available: hasGoogleConnection,
      onChange: (v: boolean) => { void handleGoogleToggle(v, "drive", { driveEnabled: v }); },
    },
    {
      slug: "google-calendar",
      label: t("integration_google_calendar"),
      checked: step.calendarEnabled,
      available: hasGoogleConnection,
      onChange: (v: boolean) => { void handleGoogleToggle(v, "calendar", { calendarEnabled: v }); },
    },
    {
      slug: "outlook",
      label: t("integration_outlook"),
      checked: step.outlookEnabled,
      available: hasMicrosoft,
      onChange: (v: boolean) => onChange({ outlookEnabled: v }),
    },
    {
      slug: "onedrive",
      label: t("integration_onedrive"),
      checked: step.onedriveEnabled,
      available: hasMicrosoft,
      onChange: (v: boolean) => onChange({ onedriveEnabled: v }),
    },
    {
      slug: "ms-calendar",
      label: t("integration_ms_calendar"),
      checked: step.msCalendarEnabled,
      available: hasMicrosoft,
      onChange: (v: boolean) => onChange({ msCalendarEnabled: v }),
    },
    {
      slug: "apple-calendar",
      label: t("integration_apple_calendar"),
      checked: step.appleCalendarEnabled,
      available: hasApple,
      onChange: (v: boolean) => onChange({ appleCalendarEnabled: v }),
    },
    {
      slug: "notion",
      label: t("integration_notion"),
      checked: step.notionEnabled,
      available: hasNotion,
      onChange: (v: boolean) => onChange({ notionEnabled: v }),
    },
    {
      slug: "cloze",
      label: t("integration_cloze"),
      checked: step.clozeEnabled,
      available: hasCloze,
      onChange: (v: boolean) => onChange({ clozeEnabled: v }),
    },
    {
      slug: "slack",
      label: t("integration_slack"),
      checked: step.slackEnabled,
      available: hasSlack,
      onChange: (v: boolean) => onChange({ slackEnabled: v }),
    },
  ];
  const visibleRows = integrationRows.filter((row) => row.available || row.checked);
  const activeRemoteIds = new Set(remoteMcpConnections.map((connection) => connection.integrationId));
  const remoteRows = remoteMcpConnections.map((connection) => ({
    ...connection,
    available: true,
    checked: step.remoteMcpIntegrationIds.includes(connection.integrationId),
  })).concat(
    step.remoteMcpIntegrationIds
      .filter((integrationId) => !activeRemoteIds.has(integrationId))
      .map((integrationId) => ({
        connectionId: integrationId,
        integrationId,
        displayName: t("remote_mcp_unavailable_server"),
        endpointHost: "",
        allowedItemCount: 0,
        available: false,
        checked: true,
      })),
  );

  return (
    <div className="space-y-2">
      <SH>{t("integrations_tools_section")}</SH>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        {visibleRows.map((row) => (
          <IntegrationRow
            key={row.label}
            slug={row.slug}
            label={row.label}
            checked={row.checked}
            subtitle={!row.available && row.checked ? t("connect_accounts_message") : undefined}
            onChange={row.onChange}
          />
        ))}
        {remoteRows.map((connection) => (
          <IntegrationRow
            key={connection.integrationId}
            slug={connection.integrationId}
            label={connection.displayName}
            subtitle={connection.available
              ? `${connection.endpointHost} · ${t("remote_mcp_allowed_items", { count: connection.allowedItemCount })}`
              : t("remote_mcp_job_disconnected_help")}
            remoteMcp
            checked={connection.checked}
            onChange={(checked) => {
              const ids = new Set(step.remoteMcpIntegrationIds);
              if (checked) ids.add(connection.integrationId);
              else ids.delete(connection.integrationId);
              onChange({ remoteMcpIntegrationIds: [...ids].sort() });
            }}
          />
        ))}
        {visibleRows.length === 0 && remoteRows.length === 0 && (
          <div className="px-4 py-3">
            <p className="text-xs text-muted">{t("connect_accounts_message")}</p>
          </div>
        )}
      </div>
      <SF>{t("enable_step_tools_footer")}</SF>
    </div>
  );
}

// ─── Search Section ─────────────────────────────────────────────────────────

const SEARCH_FOOTER_KEYS: Record<string, string> = {
  none: "search_footer_none",
  basic: "search_footer_basic",
  web: "search_footer_web",
  research: "search_footer_research",
};

export function StepSearchSection({
  step, onChange,
}: {
  step: DraftStep;
  onChange: (patch: Partial<DraftStep>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <SH>{t("internet_search_section")}</SH>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        <div className="px-4 py-3">
          <select
            value={step.searchMode}
            onChange={(e) => onChange({ searchMode: e.target.value as SearchMode })}
            className="w-full text-sm bg-transparent focus:outline-none cursor-pointer"
          >
            <option value="none">{t("search_none_option")}</option>
            <option value="basic">{t("search_basic_option")}</option>
            <option value="web">{t("search_web_option")}</option>
            <option value="research">{t("search_research_option")}</option>
          </select>
        </div>
        {(step.searchMode === "web" || step.searchMode === "research") && (
          <div className="px-4 py-3 space-y-2">
            <span className="text-xs text-muted">{t("search_complexity_label")}</span>
            <div className="flex gap-1">
              {([1, 2, 3] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => onChange({ searchComplexity: level })}
                  className={`flex-1 text-xs py-1.5 rounded-lg transition-colors ${step.searchComplexity === level ? "bg-primary text-white" : "bg-surface-3 text-foreground/70 hover:bg-surface-3/80"}`}
                >
                  {level === 1 ? t("complexity_quick") : level === 2 ? t("complexity_thorough") : t("complexity_comprehensive")}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <SF>{t(SEARCH_FOOTER_KEYS[step.searchMode])}</SF>
    </div>
  );
}

// ─── Knowledge Base Section ────────────────────────────────────────────────

export function StepKnowledgeBaseSection({
  step, onChange,
}: {
  step: DraftStep;
  onChange: (patch: Partial<DraftStep>) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selectedFileIds = useMemo(() => new Set(step.knowledgeBaseFileIds), [step.knowledgeBaseFileIds]);

  return (
    <div className="space-y-2">
      <SH>{t("knowledge_base")}</SH>
      <div className="rounded-2xl bg-surface-2 overflow-hidden">
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
        >
          <span className="text-sm flex-1">{t("knowledge_base")}</span>
          <span className="text-xs text-muted">
            {step.knowledgeBaseFileIds.length > 0
              ? `${step.knowledgeBaseFileIds.length} file${step.knowledgeBaseFileIds.length === 1 ? "" : "s"}`
              : t("none")}
          </span>
          <ChevronRight size={14} className="text-foreground/30 flex-shrink-0" />
        </button>
      </div>
      <SF>{t("files_this_step_can_reference_while_running")}</SF>

      {open && (
        <ChatKBPicker
          selectedFileIds={selectedFileIds}
          onToggle={(storageId) => {
            const next = selectedFileIds.has(storageId)
              ? step.knowledgeBaseFileIds.filter((id) => id !== storageId)
              : [...step.knowledgeBaseFileIds, storageId];
            onChange({ knowledgeBaseFileIds: next });
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Options Section (Reasoning) ────────────────────────────────────────────

export function StepOptionsSection({
  step, onChange,
}: {
  step: DraftStep;
  onChange: (patch: Partial<DraftStep>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <SH>{t("step_options_section")}</SH>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Brain size={16} className="text-primary" />
            <span className="text-sm">{t("include_reasoning")}</span>
          </div>
          <Toggle checked={step.includeReasoning} onChange={(v) => onChange({ includeReasoning: v })} />
        </div>
        {step.includeReasoning && (
          <div className="px-4 py-3 space-y-2">
            <span className="text-xs text-muted">{t("reasoning_effort_label")}</span>
            <div className="flex gap-1">
              {(["low", "medium", "high"] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => onChange({ reasoningEffort: level })}
                  className={`flex-1 text-xs py-1.5 rounded-lg capitalize transition-colors ${step.reasoningEffort === level ? "bg-primary text-white" : "bg-surface-3 text-foreground/70 hover:bg-surface-3/80"}`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <SF>
        {step.selectedPersonaId
          ? t("reasoning_override_persona_footer")
          : t("reasoning_adds_thinking_footer")}
      </SF>
    </div>
  );
}

// ─── Recurrence Picker ──────────────────────────────────────────────────────

const QUICK_INTERVALS = [
  { min: 15, label: "15m" },
  { min: 30, label: "30m" },
  { min: 60, label: "1h" },
  { min: 120, label: "2h" },
  { min: 360, label: "6h" },
  { min: 720, label: "12h" },
];
const DAY_NAME_KEYS = ["day_sunday", "day_monday", "day_tuesday", "day_wednesday", "day_thursday", "day_friday", "day_saturday"];

const RECURRENCE_FOOTER_KEYS: Record<string, string> = {
  manual: "recurrence_footer_manual",
  interval: "recurrence_footer_interval",
  daily: "recurrence_footer_daily",
  weekly: "recurrence_footer_weekly",
  cron: "recurrence_footer_cron",
};

export function RecurrencePicker({
  recurrenceType, intervalMinutes, dailyHour, dailyMinute, weeklyDay, cronExpression,
  onRecurrenceType, onIntervalMinutes, onDailyHour, onDailyMinute, onWeeklyDay, onCronExpression,
}: {
  recurrenceType: RecurrenceType; intervalMinutes: number; dailyHour: number; dailyMinute: number; weeklyDay: number; cronExpression: string;
  onRecurrenceType: (v: RecurrenceType) => void; onIntervalMinutes: (v: number) => void; onDailyHour: (v: number) => void; onDailyMinute: (v: number) => void; onWeeklyDay: (v: number) => void; onCronExpression: (v: string) => void;
}) {
  const { t } = useTranslation();
  const localTime = useMemo(() => {
    const date = new Date();
    date.setUTCHours(dailyHour, dailyMinute, 0, 0);
    return {
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }, [dailyHour, dailyMinute]);
  const localWeeklyTime = useMemo(
    () => utcWeeklyRecurrenceToLocal(weeklyDay, dailyHour, dailyMinute),
    [dailyHour, dailyMinute, weeklyDay],
  );
  const displayedTime = recurrenceType === "weekly" ? localWeeklyTime : localTime;
  const safeDisplayedTime = isValidRecurrenceTime(displayedTime.hour, displayedTime.minute)
    ? displayedTime
    : { hour: 0, minute: 0 };
  const handleWeeklyDayChange = (dayOfWeek: number) => {
    const utc = localWeeklyRecurrenceToUtc(dayOfWeek, localWeeklyTime.hour, localWeeklyTime.minute);
    onWeeklyDay(utc.dayOfWeek);
    onDailyHour(utc.hourUTC);
    onDailyMinute(utc.minuteUTC);
  };
  const handleLocalTimeChange = (hour: number, minute: number) => {
    if (recurrenceType === "weekly") {
      const utc = localWeeklyRecurrenceToUtc(localWeeklyTime.dayOfWeek, hour, minute);
      onWeeklyDay(utc.dayOfWeek);
      onDailyHour(utc.hourUTC);
      onDailyMinute(utc.minuteUTC);
      return;
    }
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    onDailyHour(d.getUTCHours());
    onDailyMinute(d.getUTCMinutes());
  };
  return (
    <div className="space-y-2">
      <SH>{t("schedule_section")}</SH>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        {/* Type picker — segmented */}
        <div className="px-4 py-3">
          <div className="flex gap-1 bg-surface-3 rounded-lg p-0.5">
            {(["manual", "interval", "daily", "weekly", "cron"] as const).map((rt) => (
              <button
                key={rt}
                onClick={() => onRecurrenceType(rt)}
                className={`flex-1 text-xs py-1.5 rounded-md capitalize transition-colors ${recurrenceType === rt ? "bg-background shadow-sm font-medium" : "text-foreground/60 hover:text-foreground"}`}
              >
                {t(`recurrence_${rt}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Type-specific controls */}
        {recurrenceType === "interval" && (
          <div className="px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">{t("every_n_minutes", { count: intervalMinutes })}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onIntervalMinutes(Math.max(15, intervalMinutes - (intervalMinutes < 60 ? 5 : intervalMinutes < 360 ? 15 : 60)))}
                  disabled={intervalMinutes <= 15}
                  className="w-7 h-7 rounded-lg bg-surface-3 flex items-center justify-center text-sm disabled:opacity-30"
                >−</button>
                <button
                  onClick={() => onIntervalMinutes(Math.min(1440, intervalMinutes + (intervalMinutes < 60 ? 5 : intervalMinutes < 360 ? 15 : 60)))}
                  disabled={intervalMinutes >= 1440}
                  className="w-7 h-7 rounded-lg bg-surface-3 flex items-center justify-center text-sm disabled:opacity-30"
                >+</button>
              </div>
            </div>
            <div className="flex gap-1">
              {QUICK_INTERVALS.map(({ min, label }) => (
                <button
                  key={min}
                  onClick={() => onIntervalMinutes(min)}
                  className={`px-2 py-1 text-xs rounded-md transition-colors ${intervalMinutes === min ? "bg-primary/20 text-primary" : "bg-surface-3 text-foreground/60 hover:text-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        {(recurrenceType === "daily" || recurrenceType === "weekly") && (
          <div className="px-4 py-3 space-y-3">
            {recurrenceType === "weekly" && (
              <div className="flex items-center justify-between">
                <span className="text-sm">{t("day_of_week_label")}</span>
                <select
                  value={localWeeklyTime.dayOfWeek}
                  onChange={(e) => handleWeeklyDayChange(Number(e.target.value))}
                  className="text-sm bg-transparent focus:outline-none cursor-pointer text-right"
                >
                  {DAY_NAME_KEYS.map((key, i) => (
                    <option key={i} value={i}>{t(key)}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm">{t("time_local_label")}</span>
              <input
                type="time"
                value={`${String(safeDisplayedTime.hour).padStart(2, "0")}:${String(safeDisplayedTime.minute).padStart(2, "0")}`}
                onChange={(e) => {
                  const parsed = parseLocalTimeInput(e.target.value);
                  if (!parsed) return;
                  handleLocalTimeChange(parsed.hour, parsed.minute);
                }}
                className="text-sm bg-transparent focus:outline-none cursor-pointer"
              />
            </div>
          </div>
        )}
        {recurrenceType === "cron" && (
          <div className="px-4 py-3">
            <input
              value={cronExpression}
              onChange={(e) => onCronExpression(e.target.value)}
              placeholder="e.g. 0 8 * * 1-5"
              className="w-full text-sm font-mono bg-transparent placeholder:text-muted focus:outline-none"
            />
          </div>
        )}
        {recurrenceType === "manual" && (
          <div className="px-4 py-3">
            <p className="text-xs text-muted">{t("manual_trigger_desc")}</p>
          </div>
        )}
      </div>
      <SF error={recurrenceType === "interval" && intervalMinutes < 15}>
        {recurrenceType === "interval" && intervalMinutes < 15
          ? t("min_interval_error")
          : t(RECURRENCE_FOOTER_KEYS[recurrenceType])}
      </SF>
    </div>
  );
}
