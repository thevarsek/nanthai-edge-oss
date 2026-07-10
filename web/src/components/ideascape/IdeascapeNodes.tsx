// components/ideascape/IdeascapeNodes.tsx
// Message node and connector rendering for the ideascape canvas.

import type { PointerEvent as ReactPointerEvent } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";
import { Video } from "lucide-react";
import { PersonaAvatar } from "@/components/shared/PersonaAvatar";
import { ProviderLogo } from "@/components/shared/ProviderLogo";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { ImageGenerationPlaceholder } from "@/components/chat/ImageGenerationPlaceholder";
import { ImageGenerationPartialSummary } from "@/components/chat/ImageGenerationPartialSummary";
import { displayMessageContent } from "@/lib/persistedGenerationError";
import { AdvisorBatchPanel } from "@/components/chat/AdvisorBatchPanel";

export { Connectors } from "./IdeascapeConnectors";

// ─── Constants ─────────────────────────────────────────────────────────────

function getModelLabel(modelId?: string): string {
  if (!modelId) return "Assistant";
  const parts = modelId.split("/");
  return parts[parts.length - 1] ?? modelId;
}

function InlineImageThumb({ url }: { url: string }) {
  return <img src={url} alt="Generated" className="h-16 w-16 rounded-md object-cover border border-border/40" />;
}

function InlineVideoThumb({ url }: { url: string }) {
  return (
    <div className="relative h-20 w-full overflow-hidden rounded-lg border border-border/40 bg-surface-2">
      <video src={url} controls className="h-full w-full object-cover" preload="metadata" playsInline />
      <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[9px] font-semibold text-white">
        <span className="inline-flex items-center gap-1">
          <Video size={9} />
          Video
        </span>
      </div>
    </div>
  );
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type NodeVisualState = "selected" | "focused" | "activeBranch" | "default";

// ─── MessageNode ────────────────────────────────────────────────────────────

export function MessageNode({
  message,
  x,
  y,
  width,
  height,
  visualState,
  isImageGeneration,
  showAdvisorPanel,
  onPointerDown,
  onResizePointerDown,
  shouldSuppressClick,
  onSelect,
  onFocus,
}: {
  message: Message;
  x: number;
  y: number;
  width: number;
  height: number;
  visualState: NodeVisualState;
  isImageGeneration?: boolean;
  showAdvisorPanel?: boolean;
  onPointerDown: (e: ReactPointerEvent, id: Id<"messages">) => void;
  onResizePointerDown: (e: ReactPointerEvent, id: Id<"messages">) => void;
  shouldSuppressClick?: (id: Id<"messages">) => boolean;
  onSelect: (id: Id<"messages">, multi: boolean) => void;
  onFocus: (id: Id<"messages">) => void;
}) {
  const projectedContent = displayMessageContent(message);
  const isAwaitingImage = isImageGeneration === true &&
    !message.imageUrls?.length &&
    (message.status === "pending" || message.status === "streaming");
  const roleColor =
    message.role === "user"
      ? "bg-surface-2"
      : "bg-surface-1";

  // Border style based on visual state (matching iOS priorities)
  const borderClass =
    visualState === "selected"
      ? "border-accent shadow-lg ring-2 ring-accent"
      : visualState === "focused"
        ? "border-orange-400/85 shadow-md"
        : visualState === "activeBranch"
          ? "border-accent/40"
          : "border-border/40";

  const borderWidth =
    visualState === "selected" ? 2.5
    : visualState === "focused" ? 2
    : visualState === "activeBranch" ? 1.5
    : 0.5;

  // Badge
  const badge =
    visualState === "selected"
      ? { label: "Context", color: "bg-accent text-white" }
      : visualState === "focused"
        ? { label: "Focus", color: "bg-orange-400 text-white" }
        : null;

  return (
    <div
      data-node-shell
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        cursor: "grab",
        userSelect: "none",
        borderWidth,
      }}
      className={`rounded-2xl border-solid shadow-sm transition-shadow ${roleColor} ${borderClass}`}
      onPointerDown={(e) => onPointerDown(e, message._id)}
      onClick={(e) => {
        if (shouldSuppressClick?.(message._id)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // Click on the node body → set focus; Shift/Meta/Ctrl → toggle selection
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          onSelect(message._id, true);
        } else {
          onFocus(message._id);
        }
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        {message.role === "user" ? (
          <div className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold bg-accent text-white">
            U
          </div>
        ) : message.participantName || message.participantAvatarImageUrl ? (
          <PersonaAvatar
            personaId={message.participantId}
            personaName={message.participantName}
            personaAvatarImageUrl={message.participantAvatarImageUrl}
            className="w-5 h-5"
            emojiClass="text-[10px]"
            initialClass="text-[9px]"
            iconSize={10}
          />
        ) : message.modelId ? (
          <ProviderLogo modelId={message.modelId} size={20} />
        ) : (
          <div className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold bg-surface-3 text-muted">
            A
          </div>
        )}
        <span className="text-[10px] font-semibold text-muted uppercase tracking-wide truncate">
          {message.role === "user"
            ? "You"
            : (message.participantName ?? getModelLabel(message.modelId))}
        </span>
        {message.status === "streaming" && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent animate-pulse flex-shrink-0" />
        )}
        {/* Select/deselect button */}
        <button
          type="button"
          className="ml-auto w-5 h-5 rounded-full flex items-center justify-center text-[10px] border border-border/40 hover:bg-surface-3 transition-colors"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(message._id, true);
          }}
          title={visualState === "selected" ? "Remove from context" : "Add to context"}
        >
          {visualState === "selected" ? "✓" : "+"}
        </button>
      </div>

      {/* Content */}
        <div
          data-node-scroll
          className="px-3 pb-7 overflow-y-auto overflow-x-hidden"
          style={{ height: Math.max(56, height - 42) }}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="space-y-2">
            {isAwaitingImage && (
              <ImageGenerationPlaceholder
                compact
                count={message.imageGenerationExpectedCount}
              />
            )}
            {!!message.imageUrls?.length && (
              <div className="flex flex-wrap gap-1.5">
                {message.imageUrls.slice(0, 3).map((url, index) => (
                  <InlineImageThumb key={`${message._id}-img-${index}`} url={url} />
                ))}
                {message.imageUrls.length > 3 && (
                  <div className="flex h-16 w-16 items-center justify-center rounded-md border border-border/40 bg-surface-2 text-[10px] font-semibold text-muted">
                    +{message.imageUrls.length - 3}
                  </div>
                )}
              </div>
            )}
            <ImageGenerationPartialSummary result={message.imageGenerationResult} compact />
            {!!message.videoUrls?.length && (
              <div className="space-y-2">
                {message.videoUrls.slice(0, 1).map((url, index) => (
                  <InlineVideoThumb key={`${message._id}-vid-${index}`} url={url} />
                ))}
              </div>
            )}
            <div className="text-foreground/80 break-words text-xs">
              {projectedContent ? (
                <MarkdownRenderer content={projectedContent} compact />
              ) : (
                <p className="leading-snug">
                  {(message.status === "pending" || message.status === "streaming") && !isAwaitingImage
                    ? <span className="text-muted animate-pulse">...</span>
                    : !isAwaitingImage && <span className="italic text-muted">empty</span>}
                </p>
              )}
            </div>
            {showAdvisorPanel && message.advisorBatchId && (
              <AdvisorBatchPanel batchId={message.advisorBatchId} compact />
            )}
          </div>
        </div>

      {/* Badge */}
      {badge && (
        <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2">
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${badge.color}`}>
            {badge.label}
          </span>
        </div>
      )}

      <button
        type="button"
        className="absolute right-1.5 bottom-1.5 h-4 w-4 rounded-sm text-muted hover:bg-surface-3/80 transition-colors cursor-se-resize hidden md:flex items-center justify-center"
        onPointerDown={(e) => {
          e.stopPropagation();
          onResizePointerDown(e, message._id);
        }}
        onClick={(e) => e.stopPropagation()}
        title="Resize card"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M2 8L8 2" />
          <path d="M5 8L8 5" />
        </svg>
      </button>
    </div>
  );
}
