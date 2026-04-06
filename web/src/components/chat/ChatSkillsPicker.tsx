// components/chat/ChatSkillsPicker.tsx
// Modal picker for per-chat skill toggles.
// Mirrors iOS ChatSkillsPickerSheet — lists all visible skills with toggles,
// grouped into discoverable (enabled for this chat) and available.

import { useMemo, useState } from "react";
import { X, Search, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Id } from "@convex/_generated/dataModel";
import { SkillRow } from "@/routes/PersonaEditorHelpers";
import type { IntegrationKey } from "@/routes/PersonaEditorForm";
import { useVisibleSkills } from "@/hooks/useSharedData";

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  /** IDs of skills currently enabled (discoverable) for this chat */
  enabledSkillIds: Set<string>;
  enabledIntegrations: Set<IntegrationKey>;
  onToggle: (skillId: Id<"skills">) => void;
  onClose: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ChatSkillsPicker({ enabledSkillIds, enabledIntegrations, onToggle, onClose }: Props) {
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

  // Split into enabled and available
  const enabled = filtered.filter((s) => enabledSkillIds.has(s._id));
  const available = filtered.filter((s) => !enabledSkillIds.has(s._id));

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
            {enabledSkillIds.size > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                {enabledSkillIds.size}
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
              {enabled.length > 0 && (
                <Section title={t("enabled_for_this_chat")}>
                  {enabled.map((s) => (
                    <SkillRow
                      key={s._id}
                      skill={s}
                      selected={true}
                      onToggle={() => onToggle(s._id)}
                    />
                  ))}
                </Section>
              )}
              <Section title={enabled.length > 0 ? t("available") : t("all_skills")}>
                {available.map((s) => (
                  <SkillRow
                    key={s._id}
                    skill={s}
                    selected={false}
                    onToggle={() => onToggle(s._id)}
                    disabled={(s.requiredIntegrationIds ?? []).some((id) => !enabledIntegrations.has(id as IntegrationKey))}
                  />
                ))}
              </Section>
            </>
          )}
        </div>
      </div>
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
