// routes/IdeascapePage.canvas.tsx
// CanvasView, Toolbar, and ContextPanel extracted from IdeascapePage
// to stay under the 300-line limit.

import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { useTranslation } from "react-i18next";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useChat } from "@/hooks/useChat";
import { useParticipants } from "@/hooks/useParticipants";
import { useChatOverrides } from "@/hooks/useChatOverrides";
import { useMentionSuggestions, useSubagentOverride, useSearchMode } from "@/routes/ChatPage.helpers";
import { useConnectedAccounts, useSharedData } from "@/hooks/useSharedData";
import { useAutonomous } from "@/hooks/useAutonomous";
import { MessageInput } from "@/components/chat/MessageInput";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { useToast } from "@/components/shared/Toast.context";
import { IdeascapeCanvas } from "@/components/ideascape/IdeascapeCanvas";
import { IdeascapeHelpDeck } from "@/components/ideascape/IdeascapeHelpDeck";
import { ChatModalPanels } from "@/routes/ChatPage.header";
import { SearchModePanel, type SearchModeState } from "@/components/chat/SearchModePanel";
import { Globe } from "lucide-react";
import type { CanvasViewport, NodePosition } from "@/components/ideascape/IdeascapeCanvas";
import { TREE_NODE_W, TREE_NODE_H } from "@/components/ideascape/treeLayout";
import { Defaults } from "@/lib/constants";
import type { RecordingResult } from "@/hooks/useAudioRecorder";
import type { Participant } from "@/hooks/useChat";
import type { AutonomousSettings } from "@/hooks/useAutonomous";
import {
  DEFAULT_PARAMETER_OVERRIDES,
  buildBaseParticipants,
  findDefaultPersona,
  resolveParticipants,
  validateSendState as validateChatSendState,
  type SharedPreferences,
} from "@/lib/chatRequestResolution";
import { attachmentTypeForMime } from "@/components/chat/MessageInput.attachments.utils";

// ─── Viewport persistence ───────────────────────────────────────────────────

function vpKey(chatId: string) {
  return `ideascape_vp_${chatId}`;
}

function loadViewport(chatId: string): CanvasViewport {
  try {
    const raw = sessionStorage.getItem(vpKey(chatId));
    if (raw) return JSON.parse(raw) as CanvasViewport;
  } catch { /* ignore */ }
  return { x: 40, y: 40, scale: 1 };
}

function saveViewport(chatId: string, vp: CanvasViewport) {
  try { sessionStorage.setItem(vpKey(chatId), JSON.stringify(vp)); }
  catch { /* ignore */ }
}

// ─── Context summary panel ──────────────────────────────────────────────────

interface ContextSummaryItem {
  id: string;
  title: string;
  subtitle: string;
}

interface ContextSummary {
  headerText: string;
  headerIcon: "scope" | "context";
  message: string;
  hasExplicitSelection: boolean;
  usedItems: ContextSummaryItem[];
  mergedItems: ContextSummaryItem[];
  showsBreakdown: boolean;
}

function summarizeMessage(message: { _id: Id<"messages">; role: string; content: string; participantName?: string; modelId?: string }, t: (key: string) => string): ContextSummaryItem {
  const title =
    message.role === "user"
      ? t("context_you")
      : message.participantName || message.modelId?.split("/").pop() || "Assistant";
  const trimmed = message.content.trim();
  const subtitle = trimmed ? trimmed.slice(0, 56) : message.role === "user" ? t("context_user_message") : t("context_assistant_message");
  return { id: message._id as string, title, subtitle };
}

function ContextPanel({ summary, totalNodes, totalTokenEstimate, isExpanded, onToggleExpanded, onClearSelection, onClose }: {
  summary: ContextSummary;
  totalNodes: number;
  totalTokenEstimate: number;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onClearSelection: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute right-4 bottom-24 z-10 bg-surface-2/95 backdrop-blur-xl border border-border/50 rounded-2xl shadow-lg p-4 w-[320px] max-w-[calc(100vw-2rem)] text-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="font-medium text-xs uppercase tracking-wide text-muted">{t("context_panel_title")}</span>
        <button onClick={onClose} className="text-muted hover:text-primary p-0.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="space-y-3 text-xs">
        <div className="space-y-1">
          <div className="flex items-start gap-2">
            <span className="text-sm leading-none mt-0.5">{summary.headerIcon === "context" ? "◌" : "◎"}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground">{summary.headerText}</p>
              <p className="text-muted leading-relaxed">{summary.message}</p>
            </div>
            {summary.hasExplicitSelection && (
              <button onClick={onClearSelection} className="text-[--nanth-primary] font-semibold hover:opacity-80">
                {t("clear")}
              </button>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between"><span className="text-muted">{t("total_nodes")}</span><span className="font-mono">{totalNodes}</span></div>
          <div className="flex justify-between"><span className="text-muted">{t("est_tokens")}</span><span className="font-mono">{totalTokenEstimate.toLocaleString()}</span></div>
        </div>

        {summary.showsBreakdown && (
          <button onClick={onToggleExpanded} className="text-[--nanth-primary] font-semibold hover:opacity-80">
            {isExpanded ? t("hide_context_details") : t("why_this_context")}
          </button>
        )}

        {isExpanded && (
          <div className="rounded-xl bg-surface-1/70 p-3 space-y-3">
            {summary.usedItems.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[--nanth-primary]">
                  {summary.hasExplicitSelection ? t("used_in_prompt") : t("focused_context")}
                </p>
                {summary.usedItems.map((item) => (
                  <div key={item.id} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[--nanth-primary] shrink-0" />
                    <div>
                      <p className="font-semibold text-foreground">{item.title}</p>
                      <p className="text-muted leading-relaxed">{item.subtitle}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {summary.mergedItems.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t("merged_away")}</p>
                {summary.mergedItems.map((item) => (
                  <div key={item.id} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-muted shrink-0" />
                    <div>
                      <p className="font-semibold text-foreground">{item.title}</p>
                      <p className="text-muted leading-relaxed">{item.subtitle}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────

const GLOBE_COLORS: Record<string, string> = {
  muted: "text-muted hover:text-foreground hover:bg-surface-3",
  green: "text-green-400 bg-green-400/10 hover:bg-green-400/20",
  blue: "text-blue-400 bg-blue-400/10 hover:bg-blue-400/20",
  orange: "text-orange-400 bg-orange-400/10 hover:bg-orange-400/20",
};

function Toolbar({ chatTitle, viewport, onResetView, onZoomIn, onZoomOut, showContext, onToggleContext, onToggleHelp,
  searchMode, globeColor, onSetSearchMode, isPro, participantCount,
}: {
  chatTitle: string; viewport: CanvasViewport; onResetView: () => void;
  onZoomIn: () => void; onZoomOut: () => void; showContext: boolean; onToggleContext: () => void; onToggleHelp: () => void;
  searchMode: SearchModeState; globeColor: "muted" | "green" | "blue" | "orange";
  onSetSearchMode: (state: SearchModeState) => void; isPro: boolean; participantCount: number;
}) {
  const { t } = useTranslation();
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const showBadge = searchMode.mode === "web" || searchMode.mode === "paper";

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 bg-surface-1 z-10">
      <h1 className="text-sm font-semibold flex-1 truncate">{chatTitle || t("ideascape")}</h1>

      {/* Globe search toggle */}
      <div className="relative">
        <button
          onClick={() => setShowSearchPanel(true)}
          className={`p-1.5 rounded-lg transition-colors select-none ${GLOBE_COLORS[globeColor]}`}
          title={searchMode.mode === "none" ? t("web_search_off") : t("search_mode_label", { mode: searchMode.mode })}
        >
          <Globe size={16} />
          {showBadge && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-surface-1 flex items-center justify-center">
              <span className="text-[8px] font-bold leading-none" style={{ color: globeColor === "blue" ? "#60a5fa" : "#fb923c" }}>
                {searchMode.complexity}
              </span>
            </span>
          )}
        </button>
        {showSearchPanel && (
          <SearchModePanel
            current={searchMode}
            onSelect={(state: SearchModeState) => { onSetSearchMode(state); setShowSearchPanel(false); }}
            onClose={() => setShowSearchPanel(false)}
            isPro={isPro}
            isMultiModel={participantCount > 1}
          />
        )}
      </div>

      <div className="flex items-center gap-1 bg-surface-2 rounded-xl px-1.5 py-1">
        <button onClick={onZoomOut} className="p-1 rounded-lg hover:bg-surface-3 transition-colors text-muted" title={t("zoom_out")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
        <span className="text-xs font-mono text-muted w-10 text-center">{Math.round(viewport.scale * 100)}%</span>
        <button onClick={onZoomIn} className="p-1 rounded-lg hover:bg-surface-3 transition-colors text-muted" title={t("zoom_in")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
      </div>
      <button onClick={onResetView} className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors text-muted" title={t("reset_view")}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
        </svg>
      </button>
      <button onClick={onToggleContext} className={`p-1.5 rounded-lg transition-colors ${showContext ? "bg-accent/15 text-accent" : "hover:bg-surface-2 text-muted"}`} title={t("toggle_context_panel")}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
        </svg>
      </button>
      <button onClick={onToggleHelp} className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors text-muted" title={t("how_ideascapes_work")}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>
    </div>
  );
}

// ─── Canvas view ─────────────────────────────────────────────────────────────

export function CanvasView({ chatId }: { chatId: Id<"chats"> }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { messages, chat, isLoading, sendMessage, cancelGeneration, updateChat, isGenerating } = useChat(chatId);
  const { participants: convexParticipants, addParticipant, removeParticipant } = useParticipants(chatId);
  const { prefs, modelSettings, proStatus, personas } = useSharedData();
  const { googleConnection, microsoftConnection, notionConnection, appleCalendarConnection } = useConnectedAccounts();
  const rawPositions = useQuery(api.nodePositions.queries.listByChat, { chatId });
  const upsertPosition = useMutation(api.nodePositions.mutations.upsert);
  const upsertPreferences = useMutation(api.preferences.mutations.upsertPreferences);
  const createUploadUrl = useMutation(api.chat.mutations.createUploadUrl);

  const [viewport, setViewport] = useState<CanvasViewport>(() => loadViewport(chatId as string));
  const [selectedIds, setSelectedIds] = useState<Set<Id<"messages">>>(new Set());
  const [focusedId, setFocusedId] = useState<Id<"messages"> | null>(null);
  const [showContext, setShowContext] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [contextExpanded, setContextExpanded] = useState(false);

  const typedPrefs = prefs as SharedPreferences | undefined;
  const defaultPersona = useMemo(
    () => findDefaultPersona(personas, typedPrefs),
    [personas, typedPrefs],
  );
  const isPro = !!(proStatus as { isPro?: boolean } | undefined)?.isPro;
  const activePersona = useMemo(() => {
    const participantPersonaId = convexParticipants.find((participant) => participant.personaId)?.personaId;
    if (participantPersonaId) {
      return (personas ?? []).find((persona) => persona._id === participantPersonaId) ?? null;
    }
    return defaultPersona ?? null;
  }, [convexParticipants, defaultPersona, personas]);
  const overrides = useChatOverrides({
    chat,
    chatId,
    activePersona,
    updateChat,
  });
  const selectedKBStorageIds = useMemo(
    () => Array.from(overrides.selectedKBFileIds) as Id<"_storage">[],
    [overrides.selectedKBFileIds],
  );
  const selectedKBFiles = useQuery(
    api.chat.queries.getKnowledgeBaseFilesByStorageIds,
    selectedKBStorageIds.length > 0 ? { storageIds: selectedKBStorageIds } : "skip",
  ) as Array<{ storageId: string; filename: string; mimeType: string; sizeBytes?: number }> | undefined;
  const { searchMode, setSearchMode: setSearchModeOverride, globeColor } = useSearchMode({
    chat, chatId, updateChat,
    webSearchEnabledByDefault: typedPrefs?.webSearchEnabledByDefault ?? true,
    defaultSearchMode: typedPrefs?.defaultSearchMode,
    defaultSearchComplexity: typedPrefs?.defaultSearchComplexity,
  });
  const webSearchEnabled = searchMode.mode !== "none";
  const convexSearchMode: "normal" | "web" | undefined = searchMode.mode === "basic" ? "normal" : searchMode.mode === "web" ? "web" : undefined;
  const convexComplexity: number | undefined = (searchMode.mode === "web" || searchMode.mode === "paper") ? searchMode.complexity : undefined;
  const isResearchPaper = searchMode.mode === "paper";
  const startResearchPaper = useMutation(api.search.mutations.startResearchPaper);
  const kbAttachments = useMemo(
    () => (selectedKBFiles ?? []).map((file) => ({
      type: file.mimeType ? attachmentTypeForMime(file.mimeType) : "file",
      storageId: file.storageId as Id<"_storage">,
      name: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    })),
    [selectedKBFiles],
  );

  useEffect(() => { saveViewport(chatId as string, viewport); }, [chatId, viewport]);

  useEffect(() => {
    if (focusedId || messages.length === 0) return;
    const latest = [...messages].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (latest) {
      const timer = window.setTimeout(() => setFocusedId(latest._id), 0);
      return () => window.clearTimeout(timer);
    }
  }, [focusedId, messages]);

  useEffect(() => {
    if (typedPrefs === undefined) return;
    const timer = window.setTimeout(() => setShowHelp(!typedPrefs?.hasSeenIdeascapeHelp), 0);
    return () => window.clearTimeout(timer);
  }, [typedPrefs]);

  const selectedModelId = defaultPersona?.modelId ?? typedPrefs?.defaultModelId ?? Defaults.model;
  const baseParticipants = useMemo(() => buildBaseParticipants({
    convexParticipants,
    defaultPersona,
    selectedModelId,
  }), [convexParticipants, defaultPersona, selectedModelId]);
  const participants = useMemo<Participant[]>(() => {
    return resolveParticipants({
      baseParticipants,
      personas,
      prefs: typedPrefs,
      modelSettings: modelSettings ?? undefined,
      overrides: overrides.paramOverrides,
    });
  }, [baseParticipants, modelSettings, overrides.paramOverrides, personas, typedPrefs]);

  const mentionSuggestions = useMentionSuggestions(participants);
  const connectedProviders = useMemo(() => ({
    google: !!googleConnection,
    microsoft: !!microsoftConnection,
    apple: !!appleCalendarConnection,
    notion: !!notionConnection,
  }), [googleConnection, microsoftConnection, appleCalendarConnection, notionConnection]);
  const hasConnectedIntegrations = Object.values(connectedProviders).some(Boolean);
  const { subagentOverride, effectiveSubagentsEnabled, handleSubagentOverrideChange } = useSubagentOverride({
    chat,
    participantCount: participants.length,
    isPro,
    subagentsEnabledByDefault: typedPrefs?.subagentsEnabledByDefault ?? false,
    chatId,
    updateChat,
  });
  const paramDefaults = useMemo(() => {
    const previewParticipant = resolveParticipants({
      baseParticipants: baseParticipants.slice(0, 1),
      personas,
      prefs: typedPrefs,
      modelSettings: modelSettings ?? undefined,
      overrides: DEFAULT_PARAMETER_OVERRIDES,
    })[0];
    return {
      temperature: previewParticipant?.temperature ?? Defaults.temperature,
      maxTokens: previewParticipant?.maxTokens,
      includeReasoning: previewParticipant?.includeReasoning ?? true,
      reasoningEffort: previewParticipant?.reasoningEffort ?? "medium",
      autoAudioResponse: typedPrefs?.autoAudioResponse ?? false,
    };
  }, [baseParticipants, modelSettings, personas, typedPrefs]);
  const autonomous = useAutonomous({ chatId, participants, hasMessages: messages.length > 0, isPro });
  const isAutonomousActive = autonomous.state.status === "active" || autonomous.state.status === "paused";

  // Compute active branch: full DAG ancestry from root(s) → focused node
  const activeBranchIds = useMemo(() => {
    if (!focusedId) return new Set<string>();
    const branch = new Set<string>();
    const stack: string[] = [focusedId as string];
    const byId = new Map(messages.map((m) => [m._id as string, m]));
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (branch.has(cur)) continue;
      branch.add(cur);
      const msg = byId.get(cur);
      if (!msg?.parentMessageIds) continue;
      for (const pid of msg.parentMessageIds) {
        const pidStr = pid as string;
        if (pidStr !== cur && !branch.has(pidStr)) stack.push(pidStr);
      }
    }
    return branch;
  }, [focusedId, messages]);

  const contextBranchIds = useMemo(() => {
    const byId = new Map(messages.map((m) => [m._id as string, m]));
    const roots = selectedIds.size > 0 ? Array.from(selectedIds).map((id) => id as string) : focusedId ? [focusedId as string] : [];
    const branch = new Set<string>();

    for (const root of roots) {
      const stack: string[] = [root];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (branch.has(cur)) continue;
        branch.add(cur);
        const msg = byId.get(cur);
        if (!msg?.parentMessageIds) continue;
        for (const pid of msg.parentMessageIds) {
          const pidStr = pid as string;
          if (pidStr !== cur && !branch.has(pidStr)) stack.push(pidStr);
        }
      }
    }

    return branch;
  }, [messages, selectedIds, focusedId]);

  const contextSummary = useMemo<ContextSummary>(() => {
    const selectedMessages = messages
      .filter((m) => selectedIds.has(m._id))
      .sort((a, b) => a.createdAt - b.createdAt);

    const usedMessages = selectedMessages.length > 0
      ? selectedMessages
      : messages.filter((m) => m._id === focusedId);

    const mergedItems = selectedMessages.length > 1
      ? selectedMessages.filter((m) => m._id !== focusedId).map((m) => summarizeMessage(m, t))
      : [];

    let message = t("context_tap_hint");
    if (selectedMessages.length > 0) {
      message = selectedMessages.length > 1
        ? t("context_multi_node", { count: selectedMessages.length })
        : t("context_one_node");
    } else if (focusedId) {
      message = t("context_focused_hint");
    }

    return {
      headerText: selectedMessages.length > 0 ? t("explicit_context") : t("focused_branch"),
      headerIcon: selectedMessages.length > 0 ? "context" : "scope",
      message,
      hasExplicitSelection: selectedMessages.length > 0,
      usedItems: usedMessages.map((m) => summarizeMessage(m, t)),
      mergedItems,
      showsBreakdown: usedMessages.length > 0 || mergedItems.length > 0,
    };
  }, [messages, selectedIds, focusedId, t]);

  const positions = useMemo(
    () => (rawPositions ?? []) as NodePosition[],
    [rawPositions],
  );
  const totalTokenEstimate = messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);

  const handleViewportChange = useCallback((vp: CanvasViewport) => { setViewport(vp); }, []);

  const handleNodeDragEnd = useCallback(
    (messageId: Id<"messages">, x: number, y: number) => {
      const existing = positions.find((p) => p.messageId === messageId);
      void upsertPosition({
        chatId,
        messageId,
        x,
        y,
        width: existing?.width ?? TREE_NODE_W,
        height: existing?.height ?? TREE_NODE_H,
      });
    },
    [chatId, positions, upsertPosition],
  );

  const handleSelectNode = useCallback((id: Id<"messages">, multi: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (multi) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => { setSelectedIds(new Set()); }, []);
  const handleFocusNode = useCallback((id: Id<"messages">) => {
    setFocusedId((prev) => prev === id ? null : id);
  }, []);

  const handleSendComposer = useCallback(
    async ({ text, attachments, recordedAudio }: {
      text: string;
      attachments?: Array<{
        type: string;
        url?: string;
        storageId?: Id<"_storage">;
        name?: string;
        mimeType?: string;
        sizeBytes?: number;
      }>;
      recordedAudio?: {
        storageId: Id<"_storage">;
        transcript: string;
        durationMs?: number;
        mimeType?: string;
      };
    }) => {
      const explicitParentIds = selectedIds.size > 0
        ? Array.from(selectedIds)
        : focusedId
          ? [focusedId]
          : [];
      const mergedAttachments = [...(attachments ?? []), ...kbAttachments];
      if (explicitParentIds.length === 0 || participants.length === 0) return;
      await overrides.flushPendingState(chatId);
      const validationError = validateChatSendState({
        participantCount: participants.length,
        isResearchPaper,
        attachmentCount: mergedAttachments.length,
        complexity: convexComplexity,
      });
      if (validationError) {
        toast({ message: validationError, variant: "error" });
        return;
      }
      if (isResearchPaper) {
        await startResearchPaper({
          chatId, text,
          participant: participants[0],
          complexity: convexComplexity ?? 1,
          attachments: mergedAttachments,
          enabledIntegrations: Array.from(overrides.enabledIntegrations),
          subagentsEnabled: effectiveSubagentsEnabled,
          explicitParentIds,
          expandMultiModelGroups: false,
        });
      } else {
        await sendMessage({
          chatId,
          text,
          participants,
          attachments: mergedAttachments,
          recordedAudio,
          explicitParentIds,
          expandMultiModelGroups: false,
          enabledIntegrations: Array.from(overrides.enabledIntegrations),
          subagentsEnabled: effectiveSubagentsEnabled,
          webSearchEnabled,
          ...(convexSearchMode ? { searchMode: convexSearchMode } : {}),
          ...(convexComplexity ? { complexity: convexComplexity } : {}),
        });
      }
      overrides.clearKBFiles();
    },
    [chatId, selectedIds, focusedId, participants, kbAttachments, sendMessage, startResearchPaper, overrides, effectiveSubagentsEnabled, webSearchEnabled, convexSearchMode, convexComplexity, isResearchPaper, toast],
  );

  const dismissHelp = useCallback(() => {
    setShowHelp(false);
    void upsertPreferences({ hasSeenIdeascapeHelp: true });
  }, [upsertPreferences]);
  const handleZoomIn = () => setViewport((vp) => ({ ...vp, scale: Math.min(3, vp.scale * 1.2) }));
  const handleZoomOut = () => setViewport((vp) => ({ ...vp, scale: Math.max(0.15, vp.scale / 1.2) }));
  const handleResetView = () => setViewport({ x: 40, y: 40, scale: 1 });

  const handleNodeResizeEnd = useCallback(
    (messageId: Id<"messages">, width: number, height: number) => {
      const existing = positions.find((p) => p.messageId === messageId);
      void upsertPosition({
        chatId,
        messageId,
        x: existing?.x ?? 0,
        y: existing?.y ?? 0,
        width,
        height,
      });
    },
    [chatId, positions, upsertPosition],
  );

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-6">
        <div className="text-3xl">💬</div>
        <p className="text-sm text-muted">{t("no_messages_yet")}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full relative">
      <Toolbar chatTitle={chat?.title ?? t("ideascape_default_title")} viewport={viewport}
        onResetView={handleResetView} onZoomIn={handleZoomIn} onZoomOut={handleZoomOut}
        showContext={showContext} onToggleContext={() => setShowContext((v) => !v)}
        onToggleHelp={() => setShowHelp((v) => !v)}
        searchMode={searchMode} globeColor={globeColor}
        onSetSearchMode={(s) => void setSearchModeOverride(s)}
        isPro={isPro} participantCount={participants.length}
      />
      <IdeascapeCanvas messages={messages} positions={positions} viewport={viewport}
        selectedIds={selectedIds} focusedId={focusedId}
        activeBranchIds={activeBranchIds} contextBranchIds={contextBranchIds}
        onViewportChange={handleViewportChange}
        onNodeDragEnd={handleNodeDragEnd} onNodeResizeEnd={handleNodeResizeEnd} onSelectNode={handleSelectNode}
        onFocusNode={handleFocusNode} onClearSelection={handleClearSelection} />
      {showHelp && <IdeascapeHelpDeck onDismiss={dismissHelp} />}
      {showContext && (
        <ContextPanel
          summary={contextSummary}
          totalNodes={messages.length}
          totalTokenEstimate={totalTokenEstimate}
          isExpanded={contextExpanded}
          onToggleExpanded={() => setContextExpanded((v) => !v)}
          onClearSelection={() => setSelectedIds(new Set())}
          onClose={() => setShowContext(false)}
        />
      )}
      <div className="shrink-0 border-t border-border/50 bg-surface-1">
        {focusedId && (
          <p className="px-4 pt-2 text-[10px] text-muted">{t("replying_to_focused")}</p>
        )}
        <MessageInput
          chatId={chatId}
          participants={participants}
          isGenerating={isGenerating}
          onSend={({ text, attachments }) => handleSendComposer({ text, attachments })}
          onCancel={() => void cancelGeneration({ chatId })}
          onCreateUploadUrl={() => createUploadUrl({})}
          onSendRecording={async (result: RecordingResult) => {
            const uploadUrl = await createUploadUrl({});
            const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": result.mimeType }, body: result.blob });
            if (!res.ok) return;
            const { storageId } = (await res.json()) as { storageId: string };
            await handleSendComposer({
              text: result.transcript || "(voice message)",
              recordedAudio: {
                storageId: storageId as Id<"_storage">,
                transcript: result.transcript,
                durationMs: result.durationMs,
                mimeType: result.mimeType,
              },
            });
          }}
          onPlusMenuSelect={overrides.handlePlusMenuSelect}
          plusMenuBadges={overrides.badges}
          disabled={!focusedId}
          isPro={isPro}
          hasConnectedIntegrations={hasConnectedIntegrations}
          participantCount={participants.length}
          hasMessages={messages.length > 0}
          mentionSuggestions={mentionSuggestions}
          isAutonomousActive={isAutonomousActive}
          onIntervene={autonomous.intervene}
        />
      </div>
      <ChatModalPanels
        activePanel={overrides.activePanel}
        closePanel={overrides.closePanel}
        paramOverrides={overrides.paramOverrides}
        setParamOverrides={overrides.setParamOverrides}
        paramDefaults={paramDefaults}
        enabledIntegrations={overrides.enabledIntegrations}
        toggleIntegration={overrides.toggleIntegration}
        connectedProviders={connectedProviders}
        enabledSkillIds={overrides.enabledSkillIds}
        toggleSkill={overrides.toggleSkill}
        selectedKBFileIds={overrides.selectedKBFileIds}
        toggleKBFile={overrides.toggleKBFile}
        chatId={chatId}
        convexParticipants={convexParticipants}
        addParticipant={addParticipant}
        removeParticipant={removeParticipant}
        subagentOverride={subagentOverride}
        effectiveSubagentsEnabled={effectiveSubagentsEnabled}
        isPro={isPro}
        handleSubagentOverrideChange={handleSubagentOverrideChange}
        autonomousSettings={autonomous.settings as AutonomousSettings}
        onAutonomousSettingsChange={autonomous.setSettings}
        participants={participants}
        hasMessages={messages.length > 0}
        onAutonomousStart={autonomous.start}
      />
    </div>
  );
}
