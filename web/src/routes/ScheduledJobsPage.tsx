import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Search, Play, Pause, Trash2,
  Clock, AlertCircle, Calendar, Plus, Pencil, CheckCircle, XCircle,
  MessageSquare,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ProGateWrapper } from "@/hooks/useProGate";
import { ScheduledJobEditor } from "./ScheduledJobEditor";

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
  nextRunAt?: number;
  lastRunAt?: number;
  lastRunError?: string;
  totalRuns?: number;
  createdBy?: string;
  createdAt?: number;
}

interface JobRunDoc {
  _id: string;
  status: string;
  startedAt: number;
  completedAt?: number;
  error?: string;
  chatId?: string;
}

type PageView = "list" | "detail" | "create" | "edit";

// ─── Helpers ────────────────────────────────────────────────────────────────

function statusDot(status: string) {
  const colors: Record<string, string> = {
    active: "bg-green-400", paused: "bg-orange-400", error: "bg-red-400",
  };
  return colors[status] ?? "bg-foreground/30";
}

function statusColor(status: string) {
  return ({ active: "text-green-400", paused: "text-orange-400", error: "text-red-400" } as Record<string, string>)[status] ?? "text-foreground/50";
}

function formatDate(ts?: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function shortModelName(modelId: string): string {
  const short = modelId.split("/").pop() ?? modelId;
  return short.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getEffectiveSteps(job: JobDoc): Array<Record<string, unknown>> {
  if (job.steps && job.steps.length > 0) return job.steps;
  return [{ prompt: job.prompt, modelId: job.modelId, personaId: job.personaId, enabledIntegrations: job.enabledIntegrations }];
}

// ─── Job Detail Panel ───────────────────────────────────────────────────────

function JobDetailPanel({
  job, onEdit, onToggle, onRunNow, onDelete,
}: {
  job: JobDoc; onEdit: () => void;
  onToggle: () => void; onRunNow: () => void; onDelete: () => void;
}) {
  const { t } = useTranslation();
  const runs = useQuery(api.scheduledJobs.queries.listRuns, { jobId: job._id, limit: 20 }) as JobRunDoc[] | undefined;
  const isActive = job.status === "active";
  const steps = getEffectiveSteps(job);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  function statusLabel(status: string) {
    const map: Record<string, string> = {
      active: t("job_status_active"),
      paused: t("job_status_paused"),
      error: t("job_status_error"),
      completed: t("job_status_completed"),
    };
    return map[status] ?? status;
  }

  function formatRelative(ts: number) {
    const diff = nowMs - ts;
    if (diff < 60_000) return t("just_now");
    if (diff < 3600_000) return t("minutes_ago", { count: Math.floor(diff / 60_000) });
    if (diff < 86400_000) return t("hours_ago", { count: Math.floor(diff / 3600_000) });
    return t("days_ago", { count: Math.floor(diff / 86400_000) });
  }

  function scheduleDescription(rec?: Record<string, unknown>): string {
    if (!rec) return t("schedule_manual");
    switch (rec.type) {
      case "manual": return t("schedule_manual");
      case "interval": return t("schedule_every_minutes", { count: rec.minutes });
      case "daily": return t("schedule_daily_at", { time: `${String(rec.hourUTC).padStart(2, "0")}:${String(rec.minuteUTC).padStart(2, "0")}` });
      case "weekly": {
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return t("schedule_weekly_at", { day: days[(rec.dayOfWeek as number) ?? 0], time: `${String(rec.hourUTC).padStart(2, "0")}:${String(rec.minuteUTC).padStart(2, "0")}` });
      }
      case "cron": return t("schedule_cron", { expression: rec.expression });
      default: return t("schedule_manual");
    }
  }

  return (
    <div className="space-y-4">
      {/* Status Section */}
      <div className="space-y-1">
        <h3 className="text-xs font-medium text-muted uppercase tracking-wide px-1">{t("status_section")}</h3>
        <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-foreground/50">{t("status_section")}</span>
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${statusDot(job.status)}`} />
              <span className={`text-sm ${statusColor(job.status)}`}>{statusLabel(job.status)}</span>
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-foreground/50">{t("schedule_label")}</span>
            <span className="text-sm text-muted">{scheduleDescription(job.recurrence)}</span>
          </div>
          {job.nextRunAt && isActive && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-foreground/50">{t("next_run_label")}</span>
              <span className="text-sm text-muted">{formatRelative(job.nextRunAt)}</span>
            </div>
          )}
          {job.lastRunAt && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-foreground/50">{t("last_run_label")}</span>
              <span className="text-sm text-muted">{formatRelative(job.lastRunAt)}</span>
            </div>
          )}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-foreground/50">{t("total_runs_label")}</span>
            <span className="text-sm text-muted">{job.totalRuns ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {job.lastRunError && (
        <div className="rounded-2xl bg-red-400/10 border border-red-400/20 px-4 py-3 flex items-start gap-3">
          <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-red-400">{t("last_run_failed")}</p>
            <p className="text-xs text-red-400/80 mt-0.5 break-words">{job.lastRunError}</p>
          </div>
        </div>
      )}

      {/* Configuration */}
      <div className="space-y-1">
        <h3 className="text-xs font-medium text-muted uppercase tracking-wide px-1">{t("configuration_label")}</h3>
        <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-foreground/50">{t("steps_count_label")}</span>
            <span className="text-sm text-muted">{steps.length}</span>
          </div>
          {steps.map((step, idx) => (
            <div key={idx} className="px-4 py-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {(step.title as string)?.trim() || `Step ${idx + 1}`}
                </span>
                <span className="text-xs text-muted">{shortModelName((step.modelId as string) ?? "")}</span>
              </div>
              <p className="text-xs text-muted line-clamp-2">{(step.prompt as string) ?? ""}</p>
              {(step.enabledIntegrations as string[] | undefined)?.length ? (
                <p className="text-[11px] text-muted">
                  {(step.enabledIntegrations as string[]).join(", ")}
                </p>
              ) : null}
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-foreground/50">{t("created_by_label")}</span>
            <span className="text-sm text-muted">{job.createdBy === "ai" ? t("created_by_ai") : t("created_by_you")}</span>
          </div>
          {job.createdAt && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-foreground/50">{t("created_label")}</span>
              <span className="text-sm text-muted">{formatDate(job.createdAt)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-1">
        <h3 className="text-xs font-medium text-muted uppercase tracking-wide px-1">{t("actions_section")}</h3>
        <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
          <button onClick={onEdit} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left">
            <Pencil size={16} className="text-primary flex-shrink-0" />
            <span className="text-sm">{t("edit_job")}</span>
          </button>
          <button onClick={onRunNow} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left">
            <Play size={16} className="text-accent flex-shrink-0" />
            <span className="text-sm">{t("run_now")}</span>
          </button>
          <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left">
            {isActive
              ? <Pause size={16} className="text-orange-400 flex-shrink-0" />
              : <Play size={16} className="text-green-400 flex-shrink-0" />}
            <span className="text-sm">{isActive ? t("pause_job") : t("resume_job")}</span>
          </button>
          <button onClick={onDelete} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-500/5 transition-colors text-left">
            <Trash2 size={16} className="text-red-400 flex-shrink-0" />
            <span className="text-sm text-red-400">{t("delete_job")}</span>
          </button>
        </div>
      </div>

      {/* Run History */}
      <div className="space-y-1">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-medium text-muted uppercase tracking-wide">{t("run_history")}</h3>
          {runs && <span className="text-xs text-muted">{t("runs_count", { count: runs.length })}</span>}
        </div>
        <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
          {!runs ? (
            <div className="flex justify-center py-4"><LoadingSpinner /></div>
          ) : runs.length === 0 ? (
            <div className="px-4 py-3"><p className="text-xs text-muted">{t("no_runs_yet")}</p></div>
          ) : (
            runs.map((run) => (
              <div key={run._id} className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  {run.status === "success"
                    ? <CheckCircle size={16} className="text-green-400 flex-shrink-0" />
                    : <XCircle size={16} className="text-red-400 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">{formatDate(run.startedAt)}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {run.completedAt && (
                        <span className="text-[11px] text-muted">
                          {Math.round((run.completedAt - run.startedAt) / 1000)}s
                        </span>
                      )}
                      <span className={`text-[11px] ${run.status === "success" ? "text-green-400" : "text-red-400"}`}>
                        {run.status === "success" ? t("job_status_active") : t("job_run_failed_label")}
                      </span>
                    </div>
                  </div>
                  {run.chatId && <MessageSquare size={12} className="text-muted flex-shrink-0" />}
                </div>
                {run.status === "failed" && run.error && (
                  <p className="text-[11px] text-foreground/50 mt-1 pl-6 break-words">{run.error}</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Job Row ────────────────────────────────────────────────────────────────

function JobRow({ job, onSelect }: { job: JobDoc; onSelect: () => void }) {
  const { t } = useTranslation();
  const nextRunLabel = job.nextRunAt && job.status === "active" ? `Next: ${formatDate(job.nextRunAt)}` : null;

  function scheduleDescription(rec?: Record<string, unknown>): string {
    if (!rec) return t("schedule_manual");
    switch (rec.type) {
      case "manual": return t("schedule_manual");
      case "interval": return t("schedule_every_minutes", { count: rec.minutes });
      case "daily": return t("schedule_daily_at", { time: `${String(rec.hourUTC).padStart(2, "0")}:${String(rec.minuteUTC).padStart(2, "0")}` });
      case "weekly": {
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return t("schedule_weekly_at", { day: days[(rec.dayOfWeek as number) ?? 0], time: `${String(rec.hourUTC).padStart(2, "0")}:${String(rec.minuteUTC).padStart(2, "0")}` });
      }
      case "cron": return t("schedule_cron", { expression: rec.expression });
      default: return t("schedule_manual");
    }
  }

  return (
    <button onClick={onSelect} className="w-full px-4 py-3 flex items-center gap-3 hover:bg-surface-3 transition-colors text-left">
      <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusDot(job.status)}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{job.name}</p>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-muted">{scheduleDescription(job.recurrence)}</span>
          {job.status === "paused" && <span className="text-xs text-orange-400">{t("job_status_paused")}</span>}
          {job.status === "error" && <span className="text-xs text-red-400">{t("job_status_error")}</span>}
          {nextRunLabel && <span className="text-xs text-foreground/50">{nextRunLabel}</span>}
        </div>
      </div>
      <ChevronRight size={14} className="text-foreground/30 flex-shrink-0" />
    </button>
  );
}

// ─── Page Content ───────────────────────────────────────────────────────────

function ScheduledJobsPageContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Id<"scheduledJobs"> | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<Id<"scheduledJobs"> | null>(null);
  const [view, setView] = useState<PageView>("list");

  const jobs = useQuery(api.scheduledJobs.queries.list, {});
  const deleteJob = useMutation(api.scheduledJobs.mutations.deleteJob);
  const pauseJob = useMutation(api.scheduledJobs.mutations.pauseJob);
  const resumeJob = useMutation(api.scheduledJobs.mutations.resumeJob);
  const runJobNow = useMutation(api.scheduledJobs.mutations.runJobNow);

  const allJobs = (jobs ?? []) as JobDoc[];
  const filteredJobs = allJobs.filter((j) => !search || j.name.toLowerCase().includes(search.toLowerCase()));
  const selectedJob = selectedJobId ? allJobs.find((j) => j._id === selectedJobId) ?? null : null;
  const activeCount = allJobs.filter((j) => j.status === "active").length;
  const pausedCount = allJobs.filter((j) => j.status === "paused").length;

  const handleBack = () => {
    if (view === "detail") { setView("list"); setSelectedJobId(null); }
    else if (view === "create" || view === "edit") { setView(selectedJob ? "detail" : "list"); }
    else navigate("/app/settings");
  };

  const handleToggle = (id: Id<"scheduledJobs">, status: string) => {
    if (status === "active") void pauseJob({ jobId: id });
    else void resumeJob({ jobId: id });
  };

  // ── Editor views ──
  if (view === "create") {
    return <ScheduledJobEditor onDone={() => setView("list")} />;
  }
  if (view === "edit" && selectedJob) {
    return <ScheduledJobEditor job={selectedJob} onDone={() => setView("detail")} />;
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 border-b border-border/50">
        <button onClick={handleBack} className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors">
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-lg font-semibold flex-1">
          {view === "detail" && selectedJob ? selectedJob.name : t("scheduled_jobs")}
        </h1>
        {view === "list" && (
          <button
            onClick={() => setView("create")}
            className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors text-primary"
          >
            <Plus size={18} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 space-y-4">
          {view === "detail" && selectedJob ? (
            <JobDetailPanel
              job={selectedJob}
              onEdit={() => setView("edit")}
              onToggle={() => handleToggle(selectedJob._id, selectedJob.status)}
              onRunNow={() => void runJobNow({ jobId: selectedJob._id })}
              onDelete={() => setDeleteTarget(selectedJob._id)}
            />
          ) : (
            <>
              {/* Search */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
                <input
                  type="search"
                  placeholder={t("search_generic_placeholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-xl bg-surface-2 text-sm border border-border/50 focus:outline-none focus:border-accent"
                />
              </div>

              {/* Statistics */}
              {allJobs.length > 0 && (
                <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Clock size={14} className="text-accent" />
                      <span className="text-sm">{t("active_jobs")}</span>
                    </div>
                    <span className="text-sm text-foreground/50">{activeCount}</span>
                  </div>
                  {pausedCount > 0 && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Pause size={14} className="text-orange-400" />
                        <span className="text-sm">{t("paused_label")}</span>
                      </div>
                      <span className="text-sm text-orange-400">{pausedCount}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Job list */}
              {jobs === undefined ? (
                <div className="flex justify-center py-8"><LoadingSpinner /></div>
              ) : filteredJobs.length === 0 ? (
                <div className="text-center py-12 space-y-3">
                  <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto">
                    <Calendar size={28} strokeWidth={1.5} className="text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{search ? t("no_matching_jobs") : t("no_scheduled_jobs")}</p>
                    <p className="text-xs text-foreground/50 mt-1 max-w-xs mx-auto">
                      {search ? t("no_jobs_match_desc") : t("no_scheduled_jobs_desc")}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
                  {filteredJobs.map((job) => (
                    <JobRow
                      key={job._id}
                      job={job}
                      onSelect={() => { setSelectedJobId(job._id); setView("detail"); }}
                    />
                  ))}
                </div>
              )}

              <p className="text-xs text-muted px-1">
                {t("scheduled_jobs_footer")}
              </p>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deleteJob({ jobId: deleteTarget });
          setDeleteTarget(null);
          setSelectedJobId(null);
          setView("list");
        }}
        title={t("delete_job_title")}
        description={t("delete_job_description")}
        confirmLabel={t("delete")}
        confirmVariant="destructive"
      />
    </div>
  );
}

export function ScheduledJobsPage() {
  return (
    <ProGateWrapper feature="Scheduled Jobs">
      <ScheduledJobsPageContent />
    </ProGateWrapper>
  );
}
