// ChatListItem.tsx
// Full-featured chat row matching iOS: avatar, context menu with all actions,
// edit/multi-select mode, scheduled job indicator, provider logos.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pin, Folder, Trash2, FolderInput, PencilLine, Copy, CheckSquare, Clock } from "lucide-react";
import { cn, formatTimestamp, truncate } from "@/lib/utils";
import { ProviderLogo } from "@/components/shared/ProviderLogo";
import { PersonaAvatar } from "@/components/shared/PersonaAvatar";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatParticipantSummary {
  modelId: string;
  personaId?: string;
  personaName?: string;
  personaEmoji?: string;
  personaAvatarImageUrl?: string;
}

export interface ChatListItemData {
  _id: string;
  title?: string;
  updatedAt?: number;
  createdAt: number;
  isPinned?: boolean;
  pinnedAt?: number;
  folderId?: string;
  lastMessagePreview?: string;
  sourceJobName?: string;
  participantSummary: ChatParticipantSummary[];
}

interface ChatListItemProps {
  chat: ChatListItemData;
  isSelected: boolean;
  isEditMode?: boolean;
  isChecked?: boolean;
  folders: Array<{ _id: string; name: string }>;
  onSelect: () => void;
  onPin: () => void;
  onDelete: () => void;
  onMoveToFolder: (folderId: string | undefined) => void;
  onRename?: () => void;
  onDuplicate?: () => void;
  onEnterEditMode?: () => void;
  onToggleCheck?: () => void;
}

// ─── Avatar helpers ───────────────────────────────────────────────────────────

function SidebarAvatarImage({ src, alt }: { src: string; alt?: string }) {
  const [didFail, setDidFail] = useState(false);

  if (didFail) return null;

  return (
    <img
      src={src}
      className="w-full h-full object-cover"
      alt={alt ?? ""}
      onError={() => setDidFail(true)}
    />
  );
}

function ParticipantAvatars({ participants }: { participants: ChatParticipantSummary[] }) {
  const visible = participants.slice(0, 3);
  if (visible.length === 0) return null;
  const isPlainMultiModelGroup =
    visible.length > 1 &&
    visible.every((participant) => !participant.personaId && !participant.personaEmoji && !participant.personaAvatarImageUrl);

  if (visible.length === 1) {
    const p = visible[0];
    // If this is a persona participant, use 4-tier fallback
    if (p.personaId) {
      return (
        <PersonaAvatar
          personaId={p.personaId}
          personaName={p.personaName}
          personaEmoji={p.personaEmoji}
          personaAvatarImageUrl={p.personaAvatarImageUrl}
        />
      );
    }
    // Plain model — provider logo
    return (
      <div className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0 overflow-hidden">
        <ProviderLogo modelId={p.modelId} size={28} />
      </div>
    );
  }

  if (isPlainMultiModelGroup) {
    const count = visible.length;
    const miniSize = count >= 3 ? 18 : 20;
    const offsets: Array<{ left: number; top: number }> =
      count === 3
        ? [
            { left: 9, top: 0 },
            { left: 0, top: 13 },
            { left: 18, top: 13 },
          ]
        : [
            { left: 2, top: 2 },
            { left: 13, top: 13 },
          ];

    return (
      <div className="relative w-9 h-9 rounded-full overflow-hidden bg-surface-2 flex-shrink-0">
        {visible.map((participant, idx) => (
          <div
            key={`${participant.modelId}-${idx}`}
            className="absolute"
            style={{ left: offsets[idx].left, top: offsets[idx].top, zIndex: count - idx }}
          >
            <ProviderLogo modelId={participant.modelId} size={miniSize} />
          </div>
        ))}
      </div>
    );
  }

  // Multi-participant: overlapping avatars (iOS style)
  return (
    <div className="relative w-9 h-9 flex-shrink-0">
      {visible.map((p, idx) => {
        const size = 24;
        const offset = idx * 7;
        return (
          <div
            key={`${p.modelId}-${idx}`}
            className="absolute rounded-full border-2 border-surface-1 flex items-center justify-center overflow-hidden"
            style={{ width: size, height: size, left: offset, top: offset, zIndex: visible.length - idx }}
          >
            {p.personaAvatarImageUrl ? (
              <SidebarAvatarImage src={p.personaAvatarImageUrl} alt={p.personaName} />
            ) : p.personaEmoji ? (
              <div className="w-full h-full bg-surface-2 flex items-center justify-center">
                <span style={{ fontSize: 11 }}>{p.personaEmoji}</span>
              </div>
            ) : p.personaId && p.personaName ? (
              <div className="w-full h-full bg-surface-2 flex items-center justify-center">
                <span className="text-[9px] font-semibold text-primary">
                  {p.personaName.charAt(0).toUpperCase()}
                </span>
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ProviderLogo modelId={p.modelId} size={size - 4} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

function ContextMenu({
  isOpen,
  onClose,
  isPinned,
  onPin,
  onDelete,
  onMoveToFolder,
  onRename,
  onDuplicate,
  onEnterEditMode,
  folders,
}: {
  isOpen: boolean;
  onClose: () => void;
  isPinned?: boolean;
  onPin: () => void;
  onDelete: () => void;
  onMoveToFolder: (folderId: string | undefined) => void;
  onRename?: () => void;
  onDuplicate?: () => void;
  onEnterEditMode?: () => void;
  folders: Array<{ _id: string; name: string }>;
}) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  const menuBtn = "w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-foreground/6 transition-colors";
  const divider = "h-px bg-foreground/8 my-1";

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-xl bg-input border border-foreground/8 shadow-2xl py-1 overflow-hidden">
        {/* Pin / Unpin */}
        <button onClick={() => { onPin(); onClose(); }} className={menuBtn}>
          <Pin size={14} />
          {isPinned ? t("unpin") : t("pin")}
        </button>

        {/* Rename */}
        {onRename && (
          <button onClick={() => { onRename(); onClose(); }} className={menuBtn}>
            <PencilLine size={14} />
            {t("rename")}
          </button>
        )}

        <div className={divider} />

        {/* Move to Folder */}
        {folders.length > 0 && (
          <>
            <div className="px-4 py-1 text-xs text-foreground/40 font-medium">
              {t("move_to_folder")}
            </div>
            <button
              onClick={() => { onMoveToFolder(undefined); onClose(); }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-foreground/6 transition-colors"
            >
              <FolderInput size={14} />
              {t("no_folder")}
            </button>
            {folders.map((f) => (
              <button
                key={f._id}
                onClick={() => { onMoveToFolder(f._id); onClose(); }}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-foreground/6 transition-colors"
              >
                <Folder size={14} />
                {f.name}
              </button>
            ))}
            <div className={divider} />
          </>
        )}

        {/* Duplicate */}
        {onDuplicate && (
          <button onClick={() => { onDuplicate(); onClose(); }} className={menuBtn}>
            <Copy size={14} />
            {t("duplicate")}
          </button>
        )}

        {/* Select Chats (enter edit mode) */}
        {onEnterEditMode && (
          <button onClick={() => { onEnterEditMode(); onClose(); }} className={menuBtn}>
            <CheckSquare size={14} />
            {t("select_chats")}
          </button>
        )}

        <div className={divider} />

        {/* Delete */}
        <button
          onClick={() => { onDelete(); onClose(); }}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 size={14} />
          {t("delete")}
        </button>
      </div>
    </>
  );
}

// ─── Chat List Item ───────────────────────────────────────────────────────────

export function ChatListItem({
  chat,
  isSelected,
  isEditMode,
  isChecked,
  folders,
  onSelect,
  onPin,
  onDelete,
  onMoveToFolder,
  onRename,
  onDuplicate,
  onEnterEditMode,
  onToggleCheck,
}: ChatListItemProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const ts = chat.updatedAt ?? chat.createdAt;
  const title = chat.title ?? t("new_chat");
  const preview = chat.lastMessagePreview ? truncate(chat.lastMessagePreview, 60) : "";

  function handleClick() {
    if (isEditMode && onToggleCheck) {
      onToggleCheck();
    } else {
      onSelect();
    }
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    if (!isEditMode) setMenuOpen(true);
  }

  return (
    <div className="relative group">
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } }}
        onContextMenu={handleContextMenu}
        className={cn(
          "relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors cursor-pointer",
          isSelected && !isEditMode
            ? "bg-primary/12 text-foreground"
            : "hover:bg-foreground/5 text-foreground",
        )}
      >
        {/* Edit mode: checkbox */}
        {isEditMode && (
          <div className={cn(
            "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
            isChecked
              ? "bg-primary border-primary"
              : "border-foreground/30",
          )}>
            {isChecked && (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2">
                <polyline points="2 6 5 9 10 3" />
              </svg>
            )}
          </div>
        )}

        {/* Selection bar (iOS-style left edge indicator) */}
        {isSelected && !isEditMode && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r bg-primary" />
        )}

        <ParticipantAvatars participants={chat.participantSummary} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium truncate flex-1">{title}</span>
            <div className="flex items-center gap-1 flex-shrink-0">
              {chat.isPinned && (
                <Pin size={11} className="text-primary" />
              )}
              <span className="text-xs text-foreground/40">
                {formatTimestamp(ts)}
              </span>
            </div>
          </div>
          {/* Scheduled job indicator */}
          {chat.sourceJobName && (
            <div className="flex items-center gap-1 mt-0.5">
              <Clock size={10} className="text-foreground/40" />
              <span className="text-[11px] text-foreground/40 truncate">{chat.sourceJobName}</span>
            </div>
          )}
          {preview && !chat.sourceJobName && (
            <p className="text-xs text-muted truncate mt-0.5">
              {preview}
            </p>
          )}
        </div>

        {/* Ellipsis menu button (hidden in edit mode) */}
        {!isEditMode && (
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(true); }}
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-lg bg-muted/95 p-1 opacity-0 shadow-sm transition-opacity hover:bg-foreground/8 group-hover:opacity-100 focus:opacity-100"
            aria-label={t("chat_options")}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <circle cx="7" cy="2.5" r="1.2" />
              <circle cx="7" cy="7" r="1.2" />
              <circle cx="7" cy="11.5" r="1.2" />
            </svg>
          </button>
        )}
      </div>

      <ContextMenu
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        isPinned={chat.isPinned}
        onPin={onPin}
        onDelete={onDelete}
        onMoveToFolder={onMoveToFolder}
        onRename={onRename}
        onDuplicate={onDuplicate}
        onEnterEditMode={onEnterEditMode}
        folders={folders}
      />
    </div>
  );
}
