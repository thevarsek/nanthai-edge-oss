// routes/ChatPage.header.tsx
// ChatHeader, EmptyChatState, and ChatModalPanels extracted from ChatPage.helpers
// to stay under the 300-line limit.

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Globe, MessageSquare, MessageCircle } from "lucide-react";
import type { Participant } from "@/hooks/useChat";
import type { SubagentOverride } from "@/components/chat/ChatSubagentsDrawer";
import type { Id } from "@convex/_generated/dataModel";
import type { ChatPanel, SkillOverrideState } from "@/hooks/useChatOverrides";
import type { ChatParameterOverrides } from "@/components/chat/ChatParametersDrawer";
import type { IntegrationKey } from "@/routes/PersonaEditorForm";
import type { AutonomousSettings } from "@/hooks/useAutonomous";
import type { ParticipantEntry, SetParticipantEntry } from "@/hooks/useParticipants";
import { ChatParametersDrawer } from "@/components/chat/ChatParametersDrawer";
import { ChatIntegrationsPicker } from "@/components/chat/ChatIntegrationsPicker";
import { ChatSkillsPicker } from "@/components/chat/ChatSkillsPicker";
import { ChatKBPicker } from "@/components/chat/ChatKBPicker";
import { ChatParticipantPicker } from "@/components/chat/ChatParticipantPicker";
import { ChatSubagentsDrawer } from "@/components/chat/ChatSubagentsDrawer";
import { AutonomousSettingsDrawer } from "@/components/chat/AutonomousSettingsDrawer";
import { SearchModePanel, type SearchModeState } from "@/components/chat/SearchModePanel";
import { useModelSummaries } from "@/hooks/useSharedData";
import { buildModelNameMap, getModelDisplayName } from "@/lib/modelDisplay";
import { formatCost, type CostBreakdown } from "@/hooks/useChatCosts";

import type { TFunction } from "i18next";

// ─── Participant subtitle helper ──────────────────────────────────────────────

function getSubtitle(participants: Participant[], modelNameMap: Map<string, string>, t: TFunction): string {
  if (participants.length === 0) return "";
  if (participants.length === 1) {
    const p = participants[0];
    if (p.personaName) return p.personaName;
    return getModelDisplayName(p.modelId, modelNameMap);
  }
  return t("num_modelarg", { var1: participants.length, var2: participants.length === 1 ? "" : "s" });
}

// ─── Chat header ──────────────────────────────────────────────────────────────
// Matches iOS ChatView+Header: tappable title for rename, monospaced subtitle,
// globe toggle + ideascape toggle in toolbar. Globe is color-coded per search mode
// with complexity badge. Right-click / long-press opens SearchModePanel.

const GLOBE_COLORS: Record<string, string> = {
  muted: "text-[--nanth-muted] hover:text-[--nanth-foreground] hover:bg-white/10",
  green: "text-green-400 bg-green-400/10 hover:bg-green-400/20",
  blue: "text-blue-400 bg-blue-400/10 hover:bg-blue-400/20",
  orange: "text-orange-400 bg-orange-400/10 hover:bg-orange-400/20",
};

export function ChatHeader({
  title, onBack, participants, onRename,
  searchMode, globeColor, onSetSearchMode,
  isPro, isMultiModel, onToggleIdeascape,
  totalCost, showAdvancedStats, breakdown,
}: {
  title: string;
  onBack: () => void;
  participants: Participant[];
  onRename?: () => void;
  searchMode: SearchModeState;
  globeColor: "muted" | "green" | "blue" | "orange";
  onSetSearchMode: (state: SearchModeState) => void;
  isPro?: boolean;
  isMultiModel?: boolean;
  onToggleIdeascape?: () => void;
  totalCost?: number | null;
  showAdvancedStats?: boolean;
  breakdown?: CostBreakdown | null;
}) {
  const { t } = useTranslation();
  const modelSummaries = useModelSummaries();
  const modelNameMap = useMemo(
    () => buildModelNameMap(modelSummaries as Parameters<typeof buildModelNameMap>[0]),
    [modelSummaries],
  );
  const subtitle = getSubtitle(participants, modelNameMap, t);
  const [showPanel, setShowPanel] = useState(false);
  const [showCostBreakdown, setShowCostBreakdown] = useState(false);

  const showCostInSubtitle = showAdvancedStats && totalCost != null;
  // Allow tapping whenever there's a cost to show — even if only response costs exist
  const hasCostBreakdown = showCostInSubtitle && breakdown != null;

  // On web, single click opens the search mode panel (not long-press — different surface than touch)
  const handleGlobeClick = useCallback(() => {
    setShowPanel(true);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setShowPanel(true);
  }, []);

  const showBadge = searchMode.mode === "web" || searchMode.mode === "paper";

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/10 bg-[--nanth-background] shrink-0">
      <button onClick={onBack} className="md:hidden p-1 rounded hover:bg-white/10 text-[--nanth-muted] hover:text-[--nanth-foreground] transition-colors">
        <ArrowLeft size={20} />
      </button>

      {/* Title + subtitle */}
      <div className="flex-1 min-w-0 text-center">
        {/* Title — tappable for rename */}
        <button
          onClick={onRename}
          className="w-full cursor-pointer hover:opacity-80 transition-opacity"
        >
          <h1 className="text-sm font-semibold text-[--nanth-foreground] truncate">
            {title || t("new_chat")}
          </h1>
        </button>

        {/* Subtitle — tappable to show cost breakdown when stats are on, otherwise static */}
        {subtitle && (
          showCostInSubtitle ? (
            <div className="relative">
              <button
                onClick={() => setShowCostBreakdown((v) => !v)}
                className="w-full text-[11px] text-[--nanth-muted] font-mono truncate hover:text-[--nanth-foreground] transition-colors"
                title={hasCostBreakdown ? t("tap_to_see_cost_breakdown") : undefined}
              >
                {subtitle} · {formatCost(totalCost!)}
              </button>
              {showCostBreakdown && hasCostBreakdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowCostBreakdown(false)} />
                  <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 w-52 rounded-xl bg-[hsl(var(--nanth-surface-2))] border border-white/10 shadow-xl py-2 px-3 space-y-1.5 text-left">
                    <p className="text-[10px] font-semibold text-[--nanth-muted] uppercase tracking-wide pb-0.5">{t("cost_breakdown")}</p>
                    <div className="flex justify-between text-[12px]">
                      <span className="text-[--nanth-muted]">{t("cost_breakdown_responses")}</span>
                      <span className="text-[--nanth-foreground]">{formatCost(breakdown!.responses)}</span>
                    </div>
                    {breakdown!.memory > 0 && (
                      <div className="flex justify-between text-[12px]">
                        <span className="text-[--nanth-muted]">{t("cost_breakdown_memory")}</span>
                        <span className="text-[--nanth-foreground]">{formatCost(breakdown!.memory)}</span>
                      </div>
                    )}
                    {breakdown!.search > 0 && (
                      <div className="flex justify-between text-[12px]">
                        <span className="text-[--nanth-muted]">{t("cost_breakdown_search")}</span>
                        <span className="text-[--nanth-foreground]">{formatCost(breakdown!.search)}</span>
                      </div>
                    )}
                    {breakdown!.other > 0 && (
                      <div className="flex justify-between text-[12px]">
                        <span className="text-[--nanth-muted]">{t("cost_breakdown_other")}</span>
                        <span className="text-[--nanth-foreground]">{formatCost(breakdown!.other)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[12px] border-t border-white/10 pt-1.5 mt-0.5 font-semibold">
                      <span className="text-[--nanth-muted]">{t("cost_breakdown_total")}</span>
                      <span className="text-[--nanth-foreground]">{formatCost(totalCost!)}</span>
                    </div>
                    <p className="text-[9px] text-[--nanth-muted]/60 pt-1">{t("cost_breakdown_search_note")}</p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-[--nanth-muted] font-mono truncate">
              {subtitle}
            </p>
          )
        )}
      </div>

      {/* Globe search toggle — click opens search mode panel */}
      <div className="relative">
        <button
          onClick={handleGlobeClick}
          onContextMenu={handleContextMenu}
          className={`p-1.5 rounded-lg transition-colors select-none ${GLOBE_COLORS[globeColor]}`}
          title={searchMode.mode === "none" ? "Web search off — click for options" : `Search: ${searchMode.mode} — click for options`}
        >
          <Globe size={18} />
          {showBadge && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[--nanth-background] flex items-center justify-center">
              <span className="text-[8px] font-bold leading-none" style={{ color: globeColor === "blue" ? "#60a5fa" : "#fb923c" }}>
                {searchMode.complexity}
              </span>
            </span>
          )}
        </button>
      </div>

      {/* Ideascape toggle — Pro only */}
      {isPro && onToggleIdeascape && (
        <button
          onClick={onToggleIdeascape}
          className="p-1.5 rounded-lg text-[--nanth-muted] hover:text-[--nanth-foreground] hover:bg-white/10 transition-colors"
          title={t("switch_to_ideascape_title")}
        >
          <MessageCircle size={18} />
        </button>
      )}

      {/* Search mode panel — modal overlay */}
      {showPanel && (
        <SearchModePanel
          current={searchMode}
          onSelect={(s) => { onSetSearchMode(s); setShowPanel(false); }}
          onClose={() => setShowPanel(false)}
          isPro={!!isPro}
          isMultiModel={!!isMultiModel}
        />
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

export function EmptyChatState() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center px-8 text-center min-h-full">
      <div className="w-16 h-16 rounded-2xl bg-[--nanth-muted]/10 border border-white/10 flex items-center justify-center mb-4">
        <MessageSquare size={28} className="text-[--nanth-muted]" />
      </div>
      <p className="text-[--nanth-foreground] font-semibold mb-1">{t("no_messages")}</p>
      <p className="text-sm text-[--nanth-muted]">{t("type_a_message_to_get_started")}</p>
    </div>
  );
}

// ─── Modal panels composite ───────────────────────────────────────────────────

export interface ChatModalPanelsProps {
  activePanel: ChatPanel; closePanel: () => void;
  paramOverrides: ChatParameterOverrides; setParamOverrides: (o: ChatParameterOverrides) => void;
  paramDefaults: {
    temperature: number;
    maxTokens: number | undefined;
    includeReasoning: boolean;
    reasoningEffort: string;
    autoAudioResponse: boolean;
  };
  enabledIntegrations: Set<IntegrationKey>; toggleIntegration: (k: IntegrationKey) => void;
  connectedProviders: { gmail: boolean; google: boolean; microsoft: boolean; apple: boolean; notion: boolean; cloze: boolean; slack: boolean };
  googleIntegrationsBlocked?: boolean;
  enabledSkillIds: Set<string>; toggleSkill: (id: Id<"skills">) => void;
  skillOverrides: Map<string, SkillOverrideState>; cycleSkill: (id: Id<"skills">) => void;
  selectedKBFileIds: Set<string>; toggleKBFile: (id: string) => void;
  chatId: Id<"chats"> | undefined; convexParticipants: ParticipantEntry[];
  addParticipant: (args: { chatId: Id<"chats">; modelId: string; personaId?: Id<"personas">; personaName?: string; personaEmoji?: string | null; personaAvatarImageUrl?: string | null }) => Promise<unknown>;
  removeParticipant: (participantId: Id<"chatParticipants">) => Promise<void>;
  setParticipants: (chatId: Id<"chats">, entries: SetParticipantEntry[]) => Promise<void>;
  subagentOverride: SubagentOverride; effectiveSubagentsEnabled: boolean;
  isPro: boolean; handleSubagentOverrideChange: (o: SubagentOverride) => void;
  autonomousSettings: AutonomousSettings; onAutonomousSettingsChange: (s: AutonomousSettings) => void;
  participants: Participant[]; hasMessages: boolean; onAutonomousStart: () => void;
}

export function ChatModalPanels(p: ChatModalPanelsProps) {
  return (
    <>
      {p.activePanel === "parameters" && (
        <ChatParametersDrawer overrides={p.paramOverrides} onChange={p.setParamOverrides} onClose={p.closePanel} defaults={p.paramDefaults} />
      )}
      {p.activePanel === "integrations" && (
        <ChatIntegrationsPicker enabledIntegrations={p.enabledIntegrations} onToggle={p.toggleIntegration} onClose={p.closePanel} connectedProviders={p.connectedProviders} googleIntegrationsBlocked={p.googleIntegrationsBlocked} />
      )}
      {p.activePanel === "skills" && (
        <ChatSkillsPicker skillOverrides={p.skillOverrides} onCycleSkill={p.cycleSkill} onClose={p.closePanel} />
      )}
      {p.activePanel === "knowledgeBase" && (
        <ChatKBPicker selectedFileIds={p.selectedKBFileIds} onToggle={p.toggleKBFile} onClose={p.closePanel} />
      )}
      {p.activePanel === "participants" && p.chatId && (
        <ChatParticipantPicker chatId={p.chatId} participants={p.convexParticipants} onAdd={p.addParticipant} onRemove={p.removeParticipant} onSetParticipants={p.setParticipants} onClose={p.closePanel} enabledIntegrations={p.enabledIntegrations} />
      )}
      {p.activePanel === "subagents" && (
        <ChatSubagentsDrawer selectedOverride={p.subagentOverride} isEffectivelyEnabled={p.effectiveSubagentsEnabled} isPro={p.isPro} onSelect={p.handleSubagentOverrideChange} onClose={p.closePanel} />
      )}
      {p.activePanel === "autonomous" && (
        <AutonomousSettingsDrawer settings={p.autonomousSettings} onChange={p.onAutonomousSettingsChange} participants={p.participants} hasMessages={p.hasMessages} onStart={p.onAutonomousStart} onClose={p.closePanel} />
      )}
    </>
  );
}
