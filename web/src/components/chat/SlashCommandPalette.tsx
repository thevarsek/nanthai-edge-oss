// components/chat/SlashCommandPalette.tsx
// M30 — Floating `/` command palette for turn-level skill/integration overrides.
// Appears when user types `/` at the start of an empty composer.

import { useMemo, useState } from "react";
import { Search, Sparkles, PuzzleIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Id } from "@convex/_generated/dataModel";
import type { SkillOverrideState } from "@/hooks/useChatOverrides";
import type { IntegrationKey } from "@/routes/PersonaEditorForm";
import { useVisibleSkills } from "@/hooks/useSharedData";

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  onSelectSkill: (skillId: Id<"skills">, skillName: string) => void;
  onSelectIntegration: (key: IntegrationKey, label: string) => void;
  onDismiss: () => void;
  /** Already-selected turn skill overrides */
  turnSkillOverrides: Map<string, SkillOverrideState>;
  /** Already-selected turn integration overrides */
  turnIntegrationOverrides: Map<string, boolean>;
  connectedProviders: {
    google: boolean;
    microsoft: boolean;
    apple: boolean;
    notion: boolean;
    cloze: boolean;
    slack: boolean;
  };
}

// ─── Integration items ──────────────────────────────────────────────────────

interface IntegrationItem {
  key: IntegrationKey;
  label: string;
  provider: string;
}

function buildConnectedIntegrations(
  connected: Props["connectedProviders"],
): IntegrationItem[] {
  const items: IntegrationItem[] = [];
  if (connected.google) {
    items.push({ key: "gmail", label: "Gmail", provider: "google" });
    items.push({ key: "drive", label: "Google Drive", provider: "google" });
    items.push({ key: "calendar", label: "Google Calendar", provider: "google" });
  }
  if (connected.microsoft) {
    items.push({ key: "outlook", label: "Outlook", provider: "microsoft" });
    items.push({ key: "onedrive", label: "OneDrive", provider: "microsoft" });
    items.push({ key: "ms_calendar", label: "MS Calendar", provider: "microsoft" });
  }
  if (connected.apple) items.push({ key: "apple_calendar", label: "Apple Calendar", provider: "apple" });
  if (connected.notion) items.push({ key: "notion", label: "Notion", provider: "notion" });
  if (connected.cloze) items.push({ key: "cloze", label: "Cloze CRM", provider: "cloze" });
  if (connected.slack) items.push({ key: "slack", label: "Slack", provider: "slack" });
  return items;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SlashCommandPalette({
  onSelectSkill,
  onSelectIntegration,
  onDismiss,
  turnSkillOverrides,
  turnIntegrationOverrides,
  connectedProviders,
}: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const skills = useVisibleSkills();

  const allSkills = useMemo(
    () => (skills ?? []) as Array<{
      _id: Id<"skills">;
      name: string;
      summary?: string;
    }>,
    [skills],
  );

  const integrationItems = useMemo(
    () => buildConnectedIntegrations(connectedProviders),
    [connectedProviders],
  );

  const query = search.toLowerCase();
  const filteredSkills = useMemo(() => {
    const available = allSkills.filter((s) => !turnSkillOverrides.has(s._id));
    if (!query) return available;
    return available.filter(
      (s) => s.name.toLowerCase().includes(query) || s.summary?.toLowerCase().includes(query),
    );
  }, [allSkills, turnSkillOverrides, query]);

  const filteredIntegrations = useMemo(() => {
    const available = integrationItems.filter((i) => !turnIntegrationOverrides.has(i.key));
    if (!query) return available;
    return available.filter((i) => i.label.toLowerCase().includes(query));
  }, [integrationItems, turnIntegrationOverrides, query]);

  const isEmpty = filteredSkills.length === 0 && filteredIntegrations.length === 0;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 z-40">
      <div
        className="mx-4 bg-surface-1 border border-border/50 rounded-xl shadow-xl overflow-hidden"
        style={{ maxHeight: "280px" }}
      >
        {/* Search */}
        <div className="px-3 pt-3 pb-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search"
              placeholder={t("search_skills_integrations")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") onDismiss(); }}
              autoFocus
              className="w-full pl-9 pr-4 py-1.5 rounded-lg text-sm bg-surface-2 border border-border/50 text-foreground placeholder-muted focus:outline-none focus:border-primary/50"
            />
          </div>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: "220px" }}>
          {isEmpty ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-muted">{t("no_results")}</p>
            </div>
          ) : (
            <>
              {filteredSkills.length > 0 && (
                <div>
                  <div className="px-4 pt-2 pb-1 flex items-center gap-1.5">
                    <Sparkles size={12} className="text-primary" />
                    <span className="text-[10px] font-medium text-muted uppercase tracking-wide">{t("skills")}</span>
                  </div>
                  {filteredSkills.map((skill) => (
                    <button
                      key={skill._id}
                      onClick={() => { onSelectSkill(skill._id, skill.name); }}
                      className="w-full flex items-center gap-2 px-4 py-2 hover:bg-surface-2 transition-colors text-left"
                    >
                      <span className="text-sm">{skill.name}</span>
                      {skill.summary && (
                        <span className="text-xs text-muted truncate">{skill.summary}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {filteredIntegrations.length > 0 && (
                <div>
                  <div className="px-4 pt-2 pb-1 flex items-center gap-1.5">
                    <PuzzleIcon size={12} className="text-primary" />
                    <span className="text-[10px] font-medium text-muted uppercase tracking-wide">{t("integrations")}</span>
                  </div>
                  {filteredIntegrations.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => { onSelectIntegration(item.key, item.label); }}
                      className="w-full flex items-center gap-2 px-4 py-2 hover:bg-surface-2 transition-colors text-left"
                    >
                      <span className="text-sm">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Turn override chips ────────────────────────────────────────────────────

interface TurnOverrideChipsProps {
  turnSkillOverrides: Map<string, SkillOverrideState>;
  turnIntegrationOverrides: Map<string, boolean>;
  onRemoveSkill: (skillId: string) => void;
  onRemoveIntegration: (key: string) => void;
  /** Skill name lookup */
  skillNames: Map<string, string>;
}

export function TurnOverrideChips({
  turnSkillOverrides,
  turnIntegrationOverrides,
  onRemoveSkill,
  onRemoveIntegration,
  skillNames,
}: TurnOverrideChipsProps) {
  if (turnSkillOverrides.size === 0 && turnIntegrationOverrides.size === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-4 py-2">
      {Array.from(turnSkillOverrides).map(([skillId, state]) => (
        <span
          key={skillId}
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary"
        >
          <Sparkles size={10} />
          {skillNames.get(skillId) ?? "Skill"}
          <span className="text-[9px] opacity-70">({state})</span>
          <button
            onClick={() => onRemoveSkill(skillId)}
            className="ml-0.5 hover:text-primary/70"
          >
            ×
          </button>
        </span>
      ))}
      {Array.from(turnIntegrationOverrides).map(([key, enabled]) => (
        <span
          key={key}
          className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${enabled ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-red-500/15 text-red-600 dark:text-red-400"}`}
        >
          <PuzzleIcon size={10} />
          {key}
          <button
            onClick={() => onRemoveIntegration(key)}
            className="ml-0.5 hover:opacity-70"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
