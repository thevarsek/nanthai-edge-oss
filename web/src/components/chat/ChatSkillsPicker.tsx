// components/chat/ChatSkillsPicker.tsx
// Modal picker for per-chat skill overrides (M30 tri-state).
// Shows all visible skills with tri-state cycling: available → always → never → (inherit).

import { useMemo, useState } from "react";
import { X, Search, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Id } from "@convex/_generated/dataModel";
import type { SkillOverrideState } from "@/hooks/useChatOverrides";
import { useVisibleSkills } from "@/hooks/useSharedData";

// ─── Skill state chip ───────────────────────────────────────────────────────

const STATE_CONFIG: Record<SkillOverrideState, { labelKey: string; bg: string; text: string }> = {
  always: { labelKey: "skill_state_always", bg: "bg-green-500/15", text: "text-green-600 dark:text-green-400" },
  available: { labelKey: "skill_state_available", bg: "bg-primary/15", text: "text-primary" },
  never: { labelKey: "skill_state_blocked", bg: "bg-red-500/15", text: "text-red-600 dark:text-red-400" },
};

function SkillStateChip({ state }: { state: SkillOverrideState }) {
  const { t } = useTranslation();
  const config = STATE_CONFIG[state];
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${config.bg} ${config.text}`}>
      {t(config.labelKey)}
    </span>
  );
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  /** M30: current skill overrides map (skillId → state) */
  skillOverrides: Map<string, SkillOverrideState>;
  /** Cycle a skill through states: available → always → never → (remove) */
  onCycleSkill: (skillId: Id<"skills">) => void;
  onClose: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ChatSkillsPicker({ skillOverrides, onCycleSkill, onClose }: Props) {
  const { t } = useTranslation();
  const skills = useVisibleSkills();
  const [search, setSearch] = useState("");

  const allSkills = useMemo(
    () => (skills ?? []) as Array<{
      _id: Id<"skills">;
      name: string;
      summary?: string;
      scope?: string;
      runtimeMode?: string;
      requiredIntegrationIds?: string[];
    }>,
    [skills],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return allSkills;
    const q = search.toLowerCase();
    return allSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.summary?.toLowerCase().includes(q),
    );
  }, [allSkills, search]);

  // Group by override state
  const overridden = filtered.filter((s) => skillOverrides.has(s._id));
  const inherited = filtered.filter((s) => !skillOverrides.has(s._id));

  const activeCount = Array.from(skillOverrides.values()).filter(
    (s) => s === "always" || s === "available",
  ).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md bg-surface-1 rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{ maxHeight: "80vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-primary" />
            <h2 className="text-base font-semibold">{t("skills")}</h2>
            {activeCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                {activeCount}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-3 text-muted hover:text-foreground transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-3 pb-1">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search"
              placeholder={t("search_skills")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl text-sm bg-surface-2 border border-border/50 text-foreground placeholder-muted focus:outline-none focus:border-primary/50"
            />
          </div>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: "calc(80vh - 8rem)" }}>
          {allSkills.length === 0 ? (
            <EmptyState />
          ) : filtered.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-muted">{t("no_skills_matching", { var1: search })}</p>
            </div>
          ) : (
            <>
              {overridden.length > 0 && (
                <Section title={t("overridden_for_this_chat")}>
                  {overridden.map((s) => (
                    <SkillOverrideRow
                      key={s._id}
                      skill={s}
                      state={skillOverrides.get(s._id)!}
                      onCycle={() => onCycleSkill(s._id)}
                    />
                  ))}
                </Section>
              )}
              <Section title={overridden.length > 0 ? t("inherited") : t("all_skills")}>
                {inherited.map((s) => (
                  <SkillOverrideRow
                    key={s._id}
                    skill={s}
                    state={undefined}
                    onCycle={() => onCycleSkill(s._id)}
                  />
                ))}
              </Section>
            </>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-3 border-t border-border/30">
          <div className="space-y-1 text-center">
            <p className="text-[10px] text-muted">
              {t("chat_skills_inherit_help")}
            </p>
            <p className="text-[10px] text-muted">
              {t("skill_override_cycle_hint")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Skill row with tri-state ───────────────────────────────────────────────

function SkillOverrideRow({
  skill,
  state,
  onCycle,
}: {
  skill: { _id: Id<"skills">; name: string; summary?: string; runtimeMode?: string };
  state: SkillOverrideState | undefined;
  onCycle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2 cursor-pointer transition-colors"
      onClick={onCycle}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm">{skill.name}</p>
        {skill.summary && (
          <p className="text-xs text-muted truncate mt-0.5">{skill.summary}</p>
        )}
      </div>
      {state ? (
        <SkillStateChip state={state} />
      ) : (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-3 text-muted font-medium">
          {t("skill_state_inherit")}
        </span>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-5 pt-4 pb-1">
        <h3 className="text-xs font-medium text-muted uppercase tracking-wide">{title}</h3>
      </div>
      <div className="divide-y divide-border/30">{children}</div>
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="px-5 py-12 text-center">
      <Sparkles size={32} className="text-muted mx-auto mb-3 opacity-40" />
      <p className="text-sm text-muted">{t("no_skills_available")}</p>
      <p className="text-xs text-muted mt-1">
        {t("create_skills_in_settings")}
      </p>
    </div>
  );
}
