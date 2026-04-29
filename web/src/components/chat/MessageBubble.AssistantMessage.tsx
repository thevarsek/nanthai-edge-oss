// components/chat/MessageBubble.AssistantMessage.tsx
// Assistant message bubble — matches iOS MessageActionBar.swift actions.

import { memo, useState, useCallback, useMemo } from "react";
import { Copy, RefreshCw, GitFork, CheckCircle, Volume2, RefreshCcw, Download, ShieldCheck, ChevronDown } from "lucide-react";
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
import { VideoGenerationProgress } from "./VideoGenerationProgress";
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
import { IconButton } from "@/components/shared/IconButton";
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
    <span className="inline-flex gap-1 items-center h-6">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-pulse"
          style={{ animationDelay: `${i * 200}ms` }}
        />
      ))}
    </span>
  );
}

function ModeratorDirectiveBlock({ directive }: { directive: string }) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = directive.trim();
  if (!trimmed) return null;

  return (
    <div className="mb-2 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2 text-xs text-muted">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 text-left font-semibold"
      >
        <ShieldCheck size={14} />
        <span className="flex-1">Moderator Guidance</span>
        <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && <p className="mt-2 whitespace-pre-wrap leading-relaxed">{trimmed}</p>}
    </div>
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

/** Inline video preview with native controls + expand-on-click lightbox. */
function InlineVideoPreview({ url }: { url: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div className="rounded-lg overflow-hidden border border-border/20 hover:border-border/40 transition-colors max-w-sm">
        <video
          src={url}
          controls
          preload="metadata"
          className="w-full max-h-64 bg-black cursor-pointer"
          onClick={(e) => {
            // Only expand on click outside the native controls area
            const rect = e.currentTarget.getBoundingClientRect();
            const controlsHeight = 40;
            if (e.clientY < rect.bottom - controlsHeight) {
              e.preventDefault();
              setExpanded(true);
            }
          }}
        />
      </div>
      {expanded && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
          onClick={() => setExpanded(false)}
        >
          <video
            src={url}
            controls
            autoPlay
            className="max-w-[90vw] max-h-[80vh] rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="mt-4 flex items-center gap-3">
            <a
              href={url}
              download
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <Download size={13} />
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
  const hasVideoUrls = !!message.videoUrls?.length;
  const isImagePlaceholder = hasImageUrls && message.content === "[Generated image]";
  const isVideoPlaceholder = hasVideoUrls && message.content === "[Generated video]";
  const contentToStream = (isImagePlaceholder || isVideoPlaceholder) ? "" : message.content;
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
  const showActions = isCompleted && (!!message.content || hasImageUrls || hasVideoUrls);

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

        {message.moderatorDirective && (
          <ModeratorDirectiveBlock directive={message.moderatorDirective} />
        )}

        {/* Reasoning */}
        {message.reasoning && (
          <ReasoningBlock reasoning={message.reasoning} isStreaming={isStreaming && message.status === "streaming"} />
        )}

        {/* Tool calls */}
        {((message.toolCalls?.length ?? 0) > 0 || (message.loadedSkillIds?.length ?? 0) > 0 || (message.usedIntegrationIds?.length ?? 0) > 0) && (
          <ToolCallAccordion
            toolCalls={message.toolCalls ?? []}
            toolResults={message.toolResults}
            isStreaming={isStreaming}
            loadedSkillIds={message.loadedSkillIds}
            usedIntegrationIds={message.usedIntegrationIds}
          />
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

        {/* Video generation status/error (hide only once the video has arrived or the message fully completed) */}
        {!hasVideoUrls && !isCompleted && (
          <VideoGenerationProgress messageId={message._id} />
        )}

        {/* Inline generated videos (from videoUrls — video generation models) */}
        {hasVideoUrls && (
          <div className="mt-2 flex flex-wrap gap-3">
            {message.videoUrls!.map((url, i) => (
              <InlineVideoPreview key={`${message._id}-vid-${i}`} url={url} />
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
              modelId={message.modelId}
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
            <p className="text-destructive text-xs italic mb-1.5">{t("generation_failed")}</p>
            <div className="flex items-center gap-0.5">
              <IconButton label="Retry" variant="ghost" size="xs" onClick={onRetry}>
                <RefreshCw size={13} />
              </IconButton>
              {onRetryWithDifferentModel && (
                <IconButton label="Retry with different model" variant="ghost" size="xs" onClick={onRetryWithDifferentModel}>
                  <RefreshCcw size={13} />
                </IconButton>
              )}
            </div>
          </div>
        )}

        {/* Action row — iOS: left-aligned (Spacer on right) */}
        {/* iOS order: Copy, Retry, Retry-different-model, Fork, Listen */}
        {showActions && (
          <div className="flex items-center gap-0.5 mt-2">
            <IconButton label="Copy" variant="ghost" size="xs" onClick={handleCopy}>
              {copied ? <CheckCircle size={13} /> : <Copy size={13} />}
            </IconButton>
            <IconButton label="Retry" variant="ghost" size="xs" onClick={onRetry}>
              <RefreshCw size={13} />
            </IconButton>
            {onRetryWithDifferentModel && (
              <IconButton label="Retry with different model" variant="ghost" size="xs" onClick={onRetryWithDifferentModel}>
                <RefreshCcw size={13} />
              </IconButton>
            )}
            <IconButton label="Fork chat" variant="ghost" size="xs" onClick={onFork}>
              <GitFork size={13} />
            </IconButton>
            {!(message.modelId && (message.modelId === "google/lyria-3-clip-preview" || message.modelId === "google/lyria-3-pro-preview")) && (
              <IconButton label={hasAudio ? "Play audio" : "Generate audio"} variant="ghost" size="xs" onClick={handlePlayAudio}>
                <Volume2 size={13} />
              </IconButton>
            )}
          </div>
        )}

        {/* Timestamp */}
        <p className="text-[11px] text-muted mt-1 font-mono tabular-nums">
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
