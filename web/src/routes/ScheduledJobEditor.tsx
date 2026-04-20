import { useState, useCallback, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ChevronLeft, Loader2 } from "lucide-react";
import { convexErrorMessage } from "@/lib/convexErrors";
import { useModelSummaries, useSharedData } from "@/hooks/useSharedData";
import {
  StepListSection,
  StepTaskSection,
  StepParticipantSection,
  StepIntegrationsSection,
  StepSearchSection,
  StepKnowledgeBaseSection,
  StepOptionsSection,
  RecurrencePicker,
  SH, SF,
} from "./ScheduledJobEditorHelpers";
import {
  type DraftStep,
  type RecurrenceType,
  type SearchMode,
  SCHEDULED_JOB_DEFAULT_MODEL,
  createDraftStep,
  buildStepsPayload,
  buildIntegrations,
} from "./ScheduledJobEditor.model";

// ─── Types ──────────────────────────────────────────────────────────────────

interface JobDoc {
  _id: Id<"scheduledJobs">;
  name: string;
  status: string;
  recurrence?: Record<string, unknown>;
  steps?: Array<Record<string, unknown>>;
  prompt?: string;
  modelId?: string;
  personaId?: string;
  enabledIntegrations?: string[];
  searchMode?: string;
  searchComplexity?: number;
  webSearchEnabled?: boolean;
  includeReasoning?: boolean;
  reasoningEffort?: string;
  targetFolderId?: string;
  knowledgeBaseFileIds?: string[];
}

interface FolderRow {
  _id: Id<"folders">;
  name: string;
}

function normalizeSearchComplexity(v?: number): number {
  return Math.max(1, Math.min(3, Math.round(v ?? 1)));
}

// ─── Load existing job into draft state ─────────────────────────────────────

function jobToSteps(job: JobDoc): DraftStep[] {
  if (job.steps && job.steps.length > 0) {
    return job.steps.map((raw) => {
      const integrations = (raw.enabledIntegrations as string[] | undefined) ?? [];
      return {
        ...createDraftStep(),
        title: (raw.title as string) ?? "",
        prompt: (raw.prompt as string) ?? "",
        modelId: (raw.modelId as string) ?? SCHEDULED_JOB_DEFAULT_MODEL,
        selectedPersonaId: (raw.personaId as string) ?? null,
        searchMode: ((raw.searchMode as string) ?? (raw.webSearchEnabled ? "basic" : "none")) as SearchMode,
        searchComplexity: normalizeSearchComplexity(raw.searchComplexity as number | undefined),
        includeReasoning: (raw.includeReasoning as boolean) ?? false,
        reasoningEffort: (raw.reasoningEffort as string) ?? "medium",
        gmailEnabled: integrations.includes("gmail"),
        driveEnabled: integrations.includes("drive"),
        calendarEnabled: integrations.includes("calendar"),
        outlookEnabled: integrations.includes("outlook"),
        onedriveEnabled: integrations.includes("onedrive"),
        msCalendarEnabled: integrations.includes("ms_calendar"),
        appleCalendarEnabled: integrations.includes("apple_calendar"),
        notionEnabled: integrations.includes("notion"),
        clozeEnabled: integrations.includes("cloze"),
        slackEnabled: integrations.includes("slack"),
        knowledgeBaseFileIds: (raw.knowledgeBaseFileIds as string[] | undefined) ?? [],
      };
    });
  }
  // Legacy single-step job
  const integrations = job.enabledIntegrations ?? [];
  return [{
    ...createDraftStep(),
    prompt: job.prompt ?? "",
    modelId: job.modelId ?? SCHEDULED_JOB_DEFAULT_MODEL,
    selectedPersonaId: job.personaId ?? null,
    searchMode: ((job.searchMode ?? (job.webSearchEnabled ? "basic" : "none")) as SearchMode),
    searchComplexity: normalizeSearchComplexity(job.searchComplexity),
    includeReasoning: job.includeReasoning ?? false,
    reasoningEffort: job.reasoningEffort ?? "medium",
    gmailEnabled: integrations.includes("gmail"),
    driveEnabled: integrations.includes("drive"),
    calendarEnabled: integrations.includes("calendar"),
    outlookEnabled: integrations.includes("outlook"),
    onedriveEnabled: integrations.includes("onedrive"),
    msCalendarEnabled: integrations.includes("ms_calendar"),
    appleCalendarEnabled: integrations.includes("apple_calendar"),
    notionEnabled: integrations.includes("notion"),
    clozeEnabled: integrations.includes("cloze"),
    slackEnabled: integrations.includes("slack"),
    knowledgeBaseFileIds: job.knowledgeBaseFileIds ?? [],
  }];
}

function jobToRecurrence(job: JobDoc): {
  type: RecurrenceType; intervalMinutes: number; dailyHour: number;
  dailyMinute: number; weeklyDay: number; cronExpression: string;
} {
  const rec = job.recurrence as Record<string, unknown> | undefined;
  if (!rec) return { type: "manual", intervalMinutes: 60, dailyHour: 8, dailyMinute: 0, weeklyDay: 1, cronExpression: "" };
  const t = rec.type as string;
  return {
    type: (t as RecurrenceType) ?? "manual",
    intervalMinutes: (rec.minutes as number) ?? 60,
    dailyHour: (rec.hourUTC as number) ?? 8,
    dailyMinute: (rec.minuteUTC as number) ?? 0,
    weeklyDay: (rec.dayOfWeek as number) ?? 1,
    cronExpression: (rec.expression as string) ?? "",
  };
}

// ─── Build recurrence payload ───────────────────────────────────────────────

function buildRecurrencePayload(
  type: RecurrenceType, intervalMinutes: number, dailyHour: number,
  dailyMinute: number, weeklyDay: number, cronExpression: string,
) {
  switch (type) {
    case "interval": return { type: "interval" as const, minutes: intervalMinutes };
    case "daily": return { type: "daily" as const, hourUTC: dailyHour, minuteUTC: dailyMinute };
    case "weekly": return { type: "weekly" as const, dayOfWeek: weeklyDay, hourUTC: dailyHour, minuteUTC: dailyMinute };
    case "cron": return { type: "cron" as const, expression: cronExpression.trim() };
    default: return { type: "manual" as const };
  }
}

// ─── Editor Component ───────────────────────────────────────────────────────

interface ScheduledJobEditorProps {
  job?: JobDoc | null; // null = create mode
  onDone: () => void;
}

export function ScheduledJobEditor({ job, onDone }: ScheduledJobEditorProps) {
  const { t } = useTranslation();
  const isEditing = !!job;

  // ── Form state ──
  const [name, setName] = useState(job?.name ?? "");
  const [steps, setSteps] = useState<DraftStep[]>(job ? jobToSteps(job) : [createDraftStep()]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const initRec = job ? jobToRecurrence(job) : null;
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>(initRec?.type ?? "daily");
  const [intervalMinutes, setIntervalMinutes] = useState(initRec?.intervalMinutes ?? 60);
  const [dailyHour, setDailyHour] = useState(initRec?.dailyHour ?? 8);
  const [dailyMinute, setDailyMinute] = useState(initRec?.dailyMinute ?? 0);
  const [weeklyDay, setWeeklyDay] = useState(initRec?.weeklyDay ?? 1);
  const [cronExpression, setCronExpression] = useState(initRec?.cronExpression ?? "");
  const [targetFolderId, setTargetFolderId] = useState<string | null>(job?.targetFolderId ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const folders = (useQuery(api.folders.queries.list) ?? []) as FolderRow[];
  const createJob = useMutation(api.scheduledJobs.mutations.createJob);
  const updateJob = useMutation(api.scheduledJobs.mutations.updateJob);
  type CreateJobArgs = Parameters<typeof createJob>[0];
  type UpdateJobArgs = Parameters<typeof updateJob>[0];

  const currentStep = steps[Math.min(Math.max(selectedIdx, 0), steps.length - 1)];

  // ── Hooks for tool-capability validation ──
  const modelSummaries = useModelSummaries();
  const { personas } = useSharedData();

  // Per-step tool-capability error
  const currentStepToolError = useMemo(() => {
    const integrations = buildIntegrations(currentStep);
    if (integrations.length === 0) return null;

    const resolvedModelId = currentStep.selectedPersonaId
      ? ((personas ?? []) as Array<{ _id: string; modelId?: string }>)
          .find((p) => p._id === currentStep.selectedPersonaId)?.modelId || currentStep.modelId
      : currentStep.modelId;

    if (!resolvedModelId) return t("choose_a_tool_capable_model_before_enabling_integrations");

    const summary = (modelSummaries ?? []).find((m) => m.modelId === resolvedModelId);
    if (!summary) return t("this_model_cannot_be_verified_for_tool_use_right_now_choose");
    if (!summary.supportsTools) return t("choose_a_model_with_tool_use_to_keep_integrations_enabled");

    return null;
  }, [currentStep, modelSummaries, personas, t]);

  // Cross-step validation summary
  const stepValidationSummary = useMemo(() => {
    const invalidIdx = steps.findIndex((step) => {
      const integrations = buildIntegrations(step);
      if (integrations.length === 0) return false;

      const resolvedModelId = step.selectedPersonaId
        ? ((personas ?? []) as Array<{ _id: string; modelId?: string }>)
            .find((p) => p._id === step.selectedPersonaId)?.modelId || step.modelId
        : step.modelId;

      if (!resolvedModelId) return true;
      const summary = (modelSummaries ?? []).find((m) => m.modelId === resolvedModelId);
      if (!summary) return true;
      return !summary.supportsTools;
    });

    if (invalidIdx < 0) return null;
    if (invalidIdx === selectedIdx) return currentStepToolError;
    return t("scheduled_step_n_tool_error", { n: invalidIdx + 1 });
  }, [steps, selectedIdx, modelSummaries, personas, currentStepToolError, t]);

  // ── Step helpers ──
  const patchStep = useCallback((patch: Partial<DraftStep>) => {
    setSteps((prev) => {
      const idx = Math.min(Math.max(selectedIdx, 0), prev.length - 1);
      const updated = [...prev];
      updated[idx] = { ...updated[idx], ...patch };
      return updated;
    });
  }, [selectedIdx]);

  const addStep = () => {
    if (steps.length >= 5) return;
    const newSteps = [...steps, createDraftStep()];
    setSteps(newSteps);
    setSelectedIdx(newSteps.length - 1);
  };

  const moveUp = () => {
    if (selectedIdx <= 0) return;
    const s = [...steps];
    [s[selectedIdx - 1], s[selectedIdx]] = [s[selectedIdx], s[selectedIdx - 1]];
    setSteps(s);
    setSelectedIdx(selectedIdx - 1);
  };

  const moveDown = () => {
    if (selectedIdx >= steps.length - 1) return;
    const s = [...steps];
    [s[selectedIdx], s[selectedIdx + 1]] = [s[selectedIdx + 1], s[selectedIdx]];
    setSteps(s);
    setSelectedIdx(selectedIdx + 1);
  };

  const removeStep = () => {
    if (steps.length <= 1) return;
    const s = steps.filter((_, i) => i !== selectedIdx);
    setSteps(s);
    setSelectedIdx(Math.min(selectedIdx, s.length - 1));
  };

  // ── Validation ──
  const isValid = name.trim().length > 0
    && steps.length >= 1 && steps.length <= 5
    && steps.every((s) => s.prompt.trim() && s.modelId.trim())
    && !(recurrenceType === "interval" && intervalMinutes < 15)
    && !(recurrenceType === "cron" && !cronExpression.trim())
    && !stepValidationSummary;

  // ── Save ──
  const handleSave = async () => {
    if (!isValid || isSaving) return;
    setError(null);
    setIsSaving(true);
    try {
      const recurrence = buildRecurrencePayload(recurrenceType, intervalMinutes, dailyHour, dailyMinute, weeklyDay, cronExpression);
      const stepsPayload = buildStepsPayload(steps);
      if (isEditing && job) {
        await updateJob({
          jobId: job._id,
          name: name.trim(),
          steps: stepsPayload as UpdateJobArgs["steps"],
          recurrence,
          ...(targetFolderId ? { targetFolderId: targetFolderId as Id<"folders"> } : {}),
        });
      } else {
        await createJob({
          name: name.trim(),
          steps: stepsPayload as CreateJobArgs["steps"],
          recurrence,
          createdBy: "user",
          ...(targetFolderId ? { targetFolderId: targetFolderId as Id<"folders"> } : {}),
        });
      }
      onDone();
    } catch (e: unknown) {
      setError(convexErrorMessage(e, t("job_save_error")));
      setIsSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border/50">
        <button onClick={onDone} className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors">
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-lg font-semibold flex-1">{isEditing ? t("edit_job_title") : t("new_scheduled_job")}</h1>
        <button
          onClick={handleSave}
          disabled={!isValid || isSaving}
          className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-primary text-white disabled:opacity-40 hover:bg-primary/90 transition-colors flex items-center gap-2"
        >
          {isSaving && <Loader2 size={14} className="animate-spin" />}
          {t("save")}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 space-y-4">
          {/* Error */}
          {error && (
            <div className="rounded-xl bg-red-400/10 border border-red-400/20 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Job Name */}
          <div className="space-y-2">
            <SH>{t("task_section")}</SH>
            <div className="rounded-2xl bg-surface-2 overflow-hidden">
              <div className="px-4 py-3">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("job_name_placeholder")}
                  className="w-full text-sm bg-transparent placeholder:text-muted focus:outline-none"
                />
              </div>
            </div>
          </div>

          <StepListSection
            steps={steps}
            selectedIdx={selectedIdx}
            onSelect={setSelectedIdx}
            onAdd={addStep}
            onMoveUp={moveUp}
            onMoveDown={moveDown}
            onRemove={removeStep}
          />
          {stepValidationSummary && stepValidationSummary !== currentStepToolError && (
            <SF error>{stepValidationSummary}</SF>
          )}

          <StepTaskSection step={currentStep} onChange={patchStep} />
          <StepParticipantSection step={currentStep} onChange={patchStep} />
          {currentStepToolError && (
            <SF error>{currentStepToolError}</SF>
          )}
          <StepIntegrationsSection step={currentStep} onChange={patchStep} />
          <StepSearchSection step={currentStep} onChange={patchStep} />
          <StepKnowledgeBaseSection step={currentStep} onChange={patchStep} />
          <StepOptionsSection step={currentStep} onChange={patchStep} />

          <RecurrencePicker
            recurrenceType={recurrenceType}
            intervalMinutes={intervalMinutes}
            dailyHour={dailyHour}
            dailyMinute={dailyMinute}
            weeklyDay={weeklyDay}
            cronExpression={cronExpression}
            onRecurrenceType={setRecurrenceType}
            onIntervalMinutes={setIntervalMinutes}
            onDailyHour={setDailyHour}
            onDailyMinute={setDailyMinute}
            onWeeklyDay={setWeeklyDay}
            onCronExpression={setCronExpression}
          />

          {/* Target Folder */}
          <div className="space-y-2">
            <SH>{t("destination_section")}</SH>
            <div className="rounded-2xl bg-surface-2 overflow-hidden">
              <div className="px-4 py-3">
                <select
                  value={targetFolderId ?? ""}
                  onChange={(e) => setTargetFolderId(e.target.value || null)}
                  className="w-full text-sm bg-transparent focus:outline-none cursor-pointer"
                >
                  <option value="">{t("scheduled_default_option")}</option>
                  {folders.map((f) => (
                    <option key={f._id} value={f._id}>{f.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
