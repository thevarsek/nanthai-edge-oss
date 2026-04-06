// components/shared/ModelPickerHelpers.tsx
// Info sheet, "Help me choose" wizard, score bars, capability badges.
// Split from ModelPicker.tsx to stay under 300 lines each.

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  X, Sparkles, Zap, DollarSign, Code2, Brain, Image, Eye, Wrench,
  Mic, FileText, Video, Gift, Check, ChevronRight,
  GraduationCap, MessageSquare, PenTool, Languages, Star, Bolt,
  ArrowLeft,
} from "lucide-react";
import { formatPrice } from "@/components/shared/ModelPickerHelpers.utils";
import { ModelSettingsEditor } from "@/components/shared/ModelSettingsEditor";

// ─── Types (shared with ModelPicker.tsx) ─────────────────────────────────────

export interface ModelSummary {
  modelId: string;
  name: string;
  description?: string;
  provider?: string;
  supportsImages?: boolean;
  supportsTools?: boolean;
  contextLength?: number;
  hasReasoning?: boolean;
  inputPricePer1M?: number;
  outputPricePer1M?: number;
  /** Server-provided: true when modelId ends with `:free`. */
  isFree?: boolean;
  architecture?: { modality?: string };
  supportedParameters?: string[];
  derivedGuidance?: {
    labels?: string[];
    primaryLabel?: string;
    supportedIntents?: string[];
    scores?: Record<string, number>;
    ranks?: Record<string, number>;
    totalRanked?: number;
  };
  openRouterUseCases?: Array<{
    category: string;
    returnedRank: number;
  }>;
}

// ─── Score bar ───────────────────────────────────────────────────────────────

function ScoreBar({ value, rank, total }: { value: number; rank?: number; total?: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.8 ? "bg-emerald-500" : value >= 0.5 ? "bg-amber-500" : "bg-foreground/25";
  const rankColor = rank != null && rank <= 3 ? "text-primary" : "text-muted";

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono tabular-nums w-7 text-right text-muted">{pct}</span>
      {rank != null && total != null && (
        <span className={`text-[10px] tabular-nums ${rankColor}`}>
          #{rank}/{total}
        </span>
      )}
    </div>
  );
}

// ─── OpenRouter category chip ────────────────────────────────────────────────

function CategoryChip({ category, rank }: { category: string; rank: number }) {
  const label = category.charAt(0).toUpperCase() + category.slice(1);
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-[10px] font-medium text-accent">
      #{Math.round(rank)} {label}
    </span>
  );
}

// ─── Capability row ──────────────────────────────────────────────────────────

function CapRow({ icon, label, supported }: { icon: React.ReactNode; label: string; supported: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2 text-sm">
        {icon}
        <span>{label}</span>
      </div>
      {supported ? (
        <Check size={14} className="text-emerald-500" />
      ) : (
        <X size={14} className="text-foreground/20" />
      )}
    </div>
  );
}

// ─── Format helpers ──────────────────────────────────────────────────────────

function formatCtx(ctx?: number): string {
  if (!ctx) return "—";
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(1)}M tokens`;
  return `${Math.round(ctx / 1000)}K tokens`;
}

// ─── Model Info Sheet ────────────────────────────────────────────────────────

export function ModelInfoSheet({
  model, onClose,
}: {
  model: ModelSummary;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const g = model.derivedGuidance;
  const scores = g?.scores;
  const ranks = g?.ranks;
  const total = g?.totalRanked;
  const useCases = model.openRouterUseCases ?? [];
  const isFree = model.isFree ?? model.modelId.endsWith(":free");
  const hasAudio = model.supportedParameters?.includes("audio") ?? false;
  const hasFileInput = model.architecture?.modality?.includes("file") ?? false;
  const hasVideo = model.architecture?.modality?.includes("video") ?? false;

  const SCORE_KEYS: { key: string; label: string; icon: React.ReactNode }[] = [
    { key: "recommended", label: t("guidance_score_recommended"), icon: <Star size={12} /> },
    { key: "coding", label: t("guidance_score_coding"), icon: <Code2 size={12} /> },
    { key: "research", label: t("guidance_score_research"), icon: <GraduationCap size={12} /> },
    { key: "fast", label: t("guidance_score_speed"), icon: <Zap size={12} /> },
    { key: "value", label: t("guidance_score_value"), icon: <DollarSign size={12} /> },
    { key: "image", label: t("guidance_score_image"), icon: <Image size={12} /> },
  ];

  return (
    <div className="flex flex-col max-h-[85vh] bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <h2 className="text-base font-semibold">{model.name}</h2>
        <button onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-muted hover:text-foreground transition-colors">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {/* Identity */}
        <div className="space-y-1">
          <p className="text-sm font-semibold">{model.name}</p>
          <p className="text-xs text-muted font-mono">{model.modelId}</p>
          {model.provider && (
            <p className="text-xs text-muted capitalize">{t("guidance_detail_provider")}: {model.provider}</p>
          )}
        </div>

        {/* Guidance scores */}
        {scores && Object.values(scores).some((v) => v != null && v > 0) && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted uppercase tracking-wide">{t("guidance_section_title")}</h3>
            {g?.primaryLabel && (
              <div className="flex items-center gap-1.5 text-sm text-primary">
                <Sparkles size={14} />
                <span className="font-medium">{g.primaryLabel}</span>
              </div>
            )}
            {g?.labels && g.labels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {g.labels.map((l) => (
                  <span key={l} className="px-2 py-0.5 rounded-full bg-accent/10 text-[10px] font-medium text-accent">
                    {l}
                  </span>
                ))}
              </div>
            )}
            {useCases.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {useCases.map((uc) => (
                  <CategoryChip key={uc.category} category={uc.category} rank={uc.returnedRank} />
                ))}
              </div>
            )}
            <div className="space-y-2 mt-2">
              {SCORE_KEYS.map(({ key, label, icon }) => {
                const s = scores[key];
                if (s == null || s === 0) return null;
                return (
                  <div key={key} className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs text-foreground/70">
                      {icon}
                      <span>{label}</span>
                    </div>
                    <ScoreBar value={s} rank={ranks?.[key]} total={total} />
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-muted mt-1">{t("guidance_attribution")}</p>
          </div>
        )}

        {/* Description */}
        {model.description && (
          <div className="space-y-1">
            <h3 className="text-xs font-medium text-muted uppercase tracking-wide">Description</h3>
            <p className="text-sm text-foreground/80 leading-relaxed">{model.description}</p>
          </div>
        )}

        {/* Pricing */}
        <div className="space-y-1">
          <h3 className="text-xs font-medium text-muted uppercase tracking-wide">{t("guidance_pricing_title")}</h3>
          {isFree ? (
            <div className="flex items-center gap-1.5 text-sm text-emerald-500">
              <Gift size={14} />
              <span className="font-medium">{t("guidance_free")}</span>
            </div>
          ) : (
            <div className="rounded-xl bg-surface-2 divide-y divide-border/50">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-muted">{t("guidance_input_price")}</span>
                <span className="text-xs font-mono">{formatPrice(model.inputPricePer1M)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-muted">{t("guidance_output_price")}</span>
                <span className="text-xs font-mono">{formatPrice(model.outputPricePer1M)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Capabilities */}
        <div className="space-y-1">
          <h3 className="text-xs font-medium text-muted uppercase tracking-wide">{t("guidance_capabilities_title")}</h3>
          <div className="rounded-xl bg-surface-2 px-3">
            <CapRow icon={<Eye size={14} className="text-muted" />} label={t("guidance_cap_vision")} supported={model.supportsImages ?? false} />
            <CapRow icon={<Wrench size={14} className="text-muted" />} label={t("guidance_cap_tools")} supported={model.supportsTools ?? false} />
            <CapRow icon={<Brain size={14} className="text-muted" />} label={t("guidance_cap_reasoning")} supported={model.hasReasoning ?? false} />
            <CapRow icon={<Mic size={14} className="text-muted" />} label="Audio Input" supported={hasAudio} />
            <CapRow icon={<FileText size={14} className="text-muted" />} label="File Input" supported={hasFileInput} />
            <CapRow icon={<Video size={14} className="text-muted" />} label="Video Input" supported={hasVideo} />
          </div>
        </div>

        {/* Details */}
        <div className="space-y-1">
          <h3 className="text-xs font-medium text-muted uppercase tracking-wide">{t("guidance_details_title")}</h3>
          <div className="rounded-xl bg-surface-2 divide-y divide-border/50">
            {model.provider && (
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-muted">{t("guidance_detail_provider")}</span>
                <span className="text-xs capitalize">{model.provider}</span>
              </div>
            )}
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-muted">{t("guidance_detail_context")}</span>
              <span className="text-xs font-mono">{formatCtx(model.contextLength)}</span>
            </div>
          </div>
        </div>

        <ModelSettingsEditor modelId={model.modelId} />
      </div>
    </div>
  );
}

// ─── "Help Me Choose" Wizard ─────────────────────────────────────────────────

type WizardTask = "everyday" | "coding" | "research" | "writing" | "translation";
type WizardPriority = "quality" | "fastest" | "value";

const TASKS: { value: WizardTask; labelKey: string; icon: React.ReactNode; orCategory: string }[] = [
  { value: "everyday", labelKey: "guidance_task_everyday", icon: <MessageSquare size={16} />, orCategory: "trivia" },
  { value: "coding", labelKey: "guidance_task_coding", icon: <Code2 size={16} />, orCategory: "programming" },
  { value: "research", labelKey: "guidance_task_research", icon: <GraduationCap size={16} />, orCategory: "academia" },
  { value: "writing", labelKey: "guidance_task_writing", icon: <PenTool size={16} />, orCategory: "marketing" },
  { value: "translation", labelKey: "guidance_task_translation", icon: <Languages size={16} />, orCategory: "translation" },
];

const PRIORITIES: { value: WizardPriority; labelKey: string; subtitleKey: string; icon: React.ReactNode }[] = [
  { value: "quality", labelKey: "guidance_priority_quality", subtitleKey: "guidance_priority_quality_sub", icon: <Star size={16} /> },
  { value: "fastest", labelKey: "guidance_priority_speed", subtitleKey: "guidance_priority_speed_sub", icon: <Bolt size={16} /> },
  { value: "value", labelKey: "guidance_priority_value", subtitleKey: "guidance_priority_value_sub", icon: <DollarSign size={16} /> },
];

function wizardScore(model: ModelSummary, task: WizardTask, priority: WizardPriority): number {
  const scores = model.derivedGuidance?.scores;
  if (!scores) return 0;

  const domainKey = task === "coding" ? "coding" : task === "research" ? "research" : "recommended";
  const priorityKey = priority === "fastest" ? "fast" : priority === "value" ? "value" : domainKey;

  if ((task === "coding" || task === "research") && priority !== "quality") {
    return (scores[domainKey] ?? 0) * 0.6 + (scores[priorityKey] ?? 0) * 0.4;
  }
  return scores[priorityKey] ?? 0;
}

export function ModelWizard({
  models, onSelect, onClose,
}: {
  models: ModelSummary[];
  onSelect: (modelId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [task, setTask] = useState<WizardTask | null>(null);
  const [priority, setPriority] = useState<WizardPriority | null>(null);

  const results = useMemo(() => {
    if (!task || !priority) return [];
    return [...models]
      .map((m) => ({ ...m, score: wizardScore(m, task, priority) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [models, task, priority]);

  const progressPct = step === 1 ? 33 : step === 2 ? 66 : 100;

  return (
    <div className="flex flex-col max-h-[85vh] bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
        {step > 1 ? (
          <button onClick={() => setStep(step - 1)} className="p-1 rounded hover:bg-surface-2 text-muted">
            <ArrowLeft size={16} />
          </button>
        ) : (
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-muted">
            <X size={16} />
          </button>
        )}
        <div className="flex-1">
          <h2 className="text-sm font-semibold">{t("guidance_help_me_choose")}</h2>
        </div>
        <span className="text-[10px] text-muted">{step}/3</span>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-surface-3">
        <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Step 1 — Task */}
        {step === 1 && (
          <>
            <p className="text-sm font-medium">{t("guidance_wizard_task_question")}</p>
            <div className="space-y-2">
              {TASKS.map((taskOption) => (
                <button
                  key={taskOption.value}
                  onClick={() => { setTask(taskOption.value); setStep(2); }}
                  className={[
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors text-left",
                    task === taskOption.value
                      ? "border-primary bg-primary/10"
                      : "border-border/50 hover:border-border hover:bg-surface-2",
                  ].join(" ")}
                >
                  <span className="text-muted">{taskOption.icon}</span>
                  <span className="text-sm font-medium">{t(taskOption.labelKey)}</span>
                  <ChevronRight size={14} className="ml-auto text-muted" />
                </button>
              ))}
            </div>
          </>
        )}

        {/* Step 2 — Priority */}
        {step === 2 && (
          <>
            <p className="text-sm font-medium">{t("guidance_wizard_priority_question")}</p>
            <div className="space-y-2">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  onClick={() => { setPriority(p.value); setStep(3); }}
                  className={[
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors text-left",
                    priority === p.value
                      ? "border-primary bg-primary/10"
                      : "border-border/50 hover:border-border hover:bg-surface-2",
                  ].join(" ")}
                >
                  <span className="text-primary">{p.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{t(p.labelKey)}</p>
                    <p className="text-[11px] text-muted">{t(p.subtitleKey)}</p>
                  </div>
                  <ChevronRight size={14} className="text-muted" />
                </button>
              ))}
            </div>
          </>
        )}

        {/* Step 3 — Results */}
        {step === 3 && (
          <>
            <p className="text-sm font-medium">
              {task === "coding"
                ? t("guidance_results_coding")
                : task === "research"
                  ? t("guidance_results_research")
                  : task === "writing"
                    ? t("guidance_results_writing")
                    : task === "translation"
                      ? t("guidance_results_translation")
                      : t("guidance_results_general")}
            </p>
            {results.length === 0 ? (
              <p className="text-sm text-muted py-6 text-center">{t("guidance_no_data")}</p>
            ) : (
              <div className="space-y-2">
                {results.map((m, i) => {
                  const taskObj = TASKS.find((taskOption) => taskOption.value === task);
                  const orMatch = m.openRouterUseCases?.find((uc) => uc.category === taskObj?.orCategory);
                  return (
                    <button
                      key={m.modelId}
                      onClick={() => { onSelect(m.modelId); onClose(); }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border/50 hover:border-primary hover:bg-primary/5 transition-colors text-left"
                    >
                      <span className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{m.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-muted capitalize">{m.provider}</span>
                          {m.derivedGuidance?.primaryLabel && (
                            <span className="text-[10px] text-accent">{m.derivedGuidance.primaryLabel}</span>
                          )}
                          {orMatch && (
                            <span className="text-[10px] text-primary">
                              #{Math.round(orMatch.returnedRank)} {taskObj ? t(taskObj.labelKey) : ""}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs font-mono text-muted">{Math.round(m.score * 100)}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-[10px] text-muted text-center">{t("benchmark_credit").trim()}</p>
          </>
        )}
      </div>
    </div>
  );
}
