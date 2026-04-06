// components/chat/MessageBubble.AssistantMessage.tsx
// Assistant message bubble — matches iOS MessageActionBar.swift actions.

import { memo, useState, useCallback, useMemo } from "react";
import { Copy, RefreshCw, GitFork, CheckCircle, Volume2, RefreshCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ReasoningBlock } from "./ReasoningBlock";
import { ToolCallAccordion } from "./ToolCallAccordion";
import { SubagentBatchPanel } from "./SubagentBatchPanel";
import { GeneratedFilesCard } from "./GeneratedFilesCard";
import { GeneratedChartsCard } from "./GeneratedChartsCard";
import { ResearchProgressPanel } from "./ResearchProgressPanel";
import { SearchSessionBadge } from "./SearchSessionBadge";
import { AudioMessageBubble } from "./AudioMessageBubble";
import { MessageAttachments } from "./MessageAttachments";
import { useAudioPlaybackContext } from "./AudioPlaybackContext.hook";
import { useChatSearchContext } from "./ChatSearchContext";
import { useSearchSessionContext } from "./SearchSessionContext";
import { isSessionActive } from "@/hooks/useSearchSessions";
import { getMatchesForMessage } from "@/hooks/useChatSearch";
import { useStreaming } from "@/hooks/useStreaming";
import type { Message, Participant } from "@/hooks/useChat";
import { PersonaAvatar } from "@/components/shared/PersonaAvatar";
import { ProviderLogo } from "@/components/shared/ProviderLogo";
import { useModelSummaries } from "@/hooks/useSharedData";
import { buildModelNameMap, getModelDisplayName } from "@/lib/modelDisplay";
import { formatCost } from "@/hooks/useChatCosts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getParticipantInitial(name?: string | null, modelId?: string): string {
  if (name) return name[0]?.toUpperCase() ?? "A";
  if (modelId) return modelId.split("/")[0]?.[0]?.toUpperCase() ?? "A";
  return "A";
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function StreamingCursor() {
  return (
    <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 align-text-bottom animate-pulse" />
  );
}

function WaitingIndicator() {
  return (
    <span
      className="inline-block text-base leading-6 font-medium tracking-[0.18em] animate-pulse"
      style={{ color: "hsl(var(--nanth-foreground) / 0.72)" }}
    >
      ...
    </span>
  );
}

/** Inline image preview with expand-on-click lightbox (for imageUrls from generation models). */
function InlineImagePreview({ url }: { url: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <button
        onClick={() => setExpanded(true)}
        className="block rounded-lg overflow-hidden border border-border/20 hover:border-border/40 transition-colors cursor-zoom-in"
      >
        <img
          src={url}
          alt="Generated image"
          className="max-w-xs max-h-64 object-contain bg-surface-2/50"
          loading="lazy"
        />
      </button>
      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
          onClick={() => setExpanded(false)}
        >
          <img
            src={url}
            alt="Generated image"
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
          />
          <div className="absolute bottom-6 flex items-center gap-3">
            <a
              href={url}
              download
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-primary hover:underline"
            >
              {t("download")}
            </a>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AssistantMessageProps {
  message: Message;
  isStreaming: boolean;
  participants: Participant[];
  onRetry: () => void;
  onRetryWithDifferentModel?: () => void;
  onFork: () => void;
  messageCost?: number;
  showAdvancedStats?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const AssistantMessage = memo(function AssistantMessage({
  message, isStreaming, participants, onRetry, onRetryWithDifferentModel, onFork,
  messageCost, showAdvancedStats,
}: AssistantMessageProps) {
  const { t } = useTranslation();
  const modelSummaries = useModelSummaries();
  const modelNameMap = useMemo(
    () => buildModelNameMap(modelSummaries as Parameters<typeof buildModelNameMap>[0]),
    [modelSummaries],
  );
  const hasImageUrls = !!message.imageUrls?.length;
  const isImagePlaceholder = hasImageUrls && message.content === "[Generated image]";
  const contentToStream = isImagePlaceholder ? "" : message.content;
  const { displayed } = useStreaming(contentToStream, isStreaming && message.status === "streaming");
  const isPending = message.status === "pending";
  const showWaitingPlaceholder = (isPending || isStreaming) && !displayed && !isImagePlaceholder;
  const [copied, setCopied] = useState(false);
  const searchCtx = useChatSearchContext();
  const { sessionMap, onCancel, onRegenerate } = useSearchSessionContext();
  const audio = useAudioPlaybackContext();

  const session = message.searchSessionId ? sessionMap.get(message.searchSessionId) : undefined;
  const sessionActive = session ? isSessionActive(session.status) : false;
  const sessionTerminal = session && !sessionActive;

  const matchedParticipant = participants.find((p) => p.modelId === message.modelId);

  const messageMatches = useMemo(
    () => getMatchesForMessage(message._id, searchCtx.matches),
    [message._id, searchCtx.matches],
  );
  const hasMatches = messageMatches.length > 0;
  const hasFocusedMatch = messageMatches.some((m) => m.globalIndex === searchCtx.focusedGlobalIndex);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  const hasAudio = !!message.audioStorageId || !!message.audioGenerating;
  const handlePlayAudio = useCallback(
    () => void audio.play(message._id, message.audioStorageId),
    [audio, message._id, message.audioStorageId],
  );

  const isCompleted = message.status === "completed";
  const showActions = isCompleted && (!!message.content || hasImageUrls);

  const outerClass = hasFocusedMatch
    ? "flex gap-3 group rounded-lg ring-2 ring-primary bg-primary/5 -mx-2 px-2 py-1 transition-all duration-200"
    : hasMatches
    ? "flex gap-3 group rounded-lg ring-1 ring-primary/30 bg-primary/5 -mx-2 px-2 py-1 transition-all duration-200"
    : "flex gap-3 group";

  return (
    <div className={outerClass}>
      {/* Avatar — iOS: 28x28 */}
      <div className="shrink-0 mt-1">
        {matchedParticipant?.personaName || matchedParticipant?.personaEmoji || matchedParticipant?.personaAvatarImageUrl ? (
          <PersonaAvatar
            personaId={matchedParticipant?.personaId ?? undefined}
            personaName={matchedParticipant?.personaName ?? undefined}
            personaEmoji={matchedParticipant?.personaEmoji ?? undefined}
            personaAvatarImageUrl={matchedParticipant?.personaAvatarImageUrl ?? undefined}
            className="w-7 h-7"
            emojiClass="text-sm"
            initialClass="text-[10px]"
            iconSize={12}
          />
        ) : message.modelId ? (
          <ProviderLogo modelId={message.modelId} size={28} />
        ) : (
          <div className="w-7 h-7 rounded-full bg-surface-2 border border-border/30 flex items-center justify-center text-[10px] font-semibold text-foreground">
            <span>{getParticipantInitial(matchedParticipant?.personaName, message.modelId)}</span>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        {/* Model label */}
        <div className="flex items-center gap-2 mb-1">
          <p className="text-xs text-muted">
            {matchedParticipant?.personaName ?? getModelDisplayName(message.modelId, modelNameMap)}
          </p>
          {hasMatches && (
             <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary font-medium">
              {messageMatches.length === 1 ? t("n_matches", { count: messageMatches.length }) : t("n_matches_plural", { count: messageMatches.length })}
            </span>
          )}
        </div>

        {/* Reasoning */}
        {message.reasoning && (
          <ReasoningBlock reasoning={message.reasoning} isStreaming={isStreaming && message.status === "streaming"} />
        )}

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallAccordion toolCalls={message.toolCalls} toolResults={message.toolResults} isStreaming={isStreaming} />
        )}

        {/* Subagent work */}
        {message.subagentBatchId && <SubagentBatchPanel messageId={message._id} />}

        {/* Content */}
        {(displayed || showWaitingPlaceholder) && (
          <div className="max-w-none">
            <MarkdownRenderer content={displayed} streaming={isStreaming && message.status === "streaming"} />
            {showWaitingPlaceholder && (
              displayed ? <StreamingCursor /> : <WaitingIndicator />
            )}
          </div>
        )}

        {/* Inline generated images (from imageUrls — DALL-E, etc.) */}
        {hasImageUrls && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.imageUrls!.map((url, i) => (
              <InlineImagePreview key={`${message._id}-img-${i}`} url={url} />
            ))}
          </div>
        )}

        {/* Inline audio player */}
        {hasAudio && (
          <div className="mt-2">
            <AudioMessageBubble
              messageId={message._id} durationMs={message.audioDurationMs}
              isGenerating={message.audioGenerating} role="assistant"
              playbackState={audio.state} onPlay={handlePlayAudio}
              onPause={audio.pause} onSeek={audio.seek} onCycleSpeed={audio.cycleSpeed}
            />
          </div>
        )}

        {/* Generated files */}
        {message.generatedFileIds && message.generatedFileIds.length > 0 && <GeneratedFilesCard messageId={message._id} />}
        {message.generatedChartIds && message.generatedChartIds.length > 0 && <GeneratedChartsCard messageId={message._id} />}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2">
            <MessageAttachments
              attachments={message.attachments}
              messageId={message._id}
              isUser={false}
            />
          </div>
        )}

        {/* Research progress / session badge */}
        {session && sessionActive && <ResearchProgressPanel session={session} onCancel={() => onCancel(session._id)} />}
        {session && sessionTerminal && (
          <div className="mt-2 space-y-2">
            <SearchSessionBadge session={session} />
            {session.mode === "paper" && (session.status === "completed" || session.status === "failed") && (
              <button
                onClick={() => onRegenerate(session._id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-3 hover:text-foreground transition-colors"
                title="Regenerate paper"
              >
                <RefreshCcw size={13} />
                Regenerate paper
              </button>
            )}
          </div>
        )}

        {/* Error state — show retry actions inline so the user can act */}
        {message.status === "failed" && (
          <div className="mt-2">
            <p className="text-red-400 text-xs italic mb-1.5">{t("generation_failed")}</p>
            <div className="flex items-center gap-0.5">
              <button onClick={onRetry} className="p-1.5 rounded hover:bg-surface-3 text-muted hover:text-foreground transition-colors" title="Retry">
                <RefreshCw size={13} />
              </button>
              {onRetryWithDifferentModel && (
                <button onClick={onRetryWithDifferentModel} className="p-1.5 rounded hover:bg-surface-3 text-muted hover:text-foreground transition-colors" title="Retry with different model">
                  <RefreshCcw size={13} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Action row — iOS: left-aligned (Spacer on right) */}
        {/* iOS order: Copy, Retry, Retry-different-model, Fork, Listen */}
        {showActions && (
          <div className="flex items-center gap-0.5 mt-2">
            <button onClick={handleCopy} className="p-1.5 rounded hover:bg-surface-3 text-muted hover:text-foreground transition-colors" title="Copy">
              {copied ? <CheckCircle size={13} /> : <Copy size={13} />}
            </button>
            <button onClick={onRetry} className="p-1.5 rounded hover:bg-surface-3 text-muted hover:text-foreground transition-colors" title="Retry">
              <RefreshCw size={13} />
            </button>
            {onRetryWithDifferentModel && (
              <button onClick={onRetryWithDifferentModel} className="p-1.5 rounded hover:bg-surface-3 text-muted hover:text-foreground transition-colors" title="Retry with different model">
                <RefreshCcw size={13} />
              </button>
            )}
            <button onClick={onFork} className="p-1.5 rounded hover:bg-surface-3 text-muted hover:text-foreground transition-colors" title="Fork chat">
              <GitFork size={13} />
            </button>
            <button onClick={handlePlayAudio} className="p-1.5 rounded hover:bg-surface-3 text-muted hover:text-foreground transition-colors" title={hasAudio ? "Play audio" : "Generate audio"}>
                <Volume2 size={13} />
            </button>
          </div>
        )}

        {/* Timestamp */}
        <p className="text-[10px] text-muted mt-1 font-mono">
          {formatTimestamp(message._creationTime)}
          {showAdvancedStats && (
            <span className="ml-1">
              · {messageCost !== undefined ? formatCost(messageCost) : "$—"}
            </span>
          )}
        </p>
      </div>
    </div>
  );
});
