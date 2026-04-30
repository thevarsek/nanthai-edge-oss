// SidebarSections.tsx
// Sub-components for Sidebar: PinnedSection, TimeGroupSection,
// FolderDropdown, FilterMenu, NewFolderDialog, RenameChatDialog,
// FolderManagerDialog, EditModeBar.
// Mirrors iOS ChatListView+Rows.swift and FolderManagerView.swift.

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Pin, ChevronDown, ChevronRight, Folder, Check,
  Clock, FolderCog, GripVertical, PencilLine, Trash2,
  FolderPlus, Search,
} from "lucide-react";
import { ChatListItem } from "@/components/chat-list/ChatListItem";
import { cn } from "@/lib/utils";
import type { Id } from "@convex/_generated/dataModel";

// ─── Drag-reorder hook for pinned chats ───────────────────────────────────────

function useDragReorder<T extends { _id: Id<"chats"> }>(
  items: T[],
  onReorder: (orderedIds: Id<"chats">[]) => void,
) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [localItems, setLocalItems] = useState(items);
  const renderedItems = dragIdx === null ? items : localItems;

  const onDragStart = useCallback((idx: number) => {
    setLocalItems(items);
    setDragIdx(idx);
    setOverIdx(null);
  }, [items]);

  const onDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverIdx(idx);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      const reordered = [...localItems];
      const [moved] = reordered.splice(dragIdx, 1);
      reordered.splice(overIdx, 0, moved);
      setLocalItems(reordered);
      onReorder(reordered.map((c) => c._id));
    }
    setDragIdx(null);
    setOverIdx(null);
  }, [dragIdx, overIdx, localItems, onReorder]);

  const onDragEnd = useCallback(() => {
    setDragIdx(null);
    setOverIdx(null);
  }, []);

  return { renderedItems, dragIdx, overIdx, onDragStart, onDragOver, onDrop, onDragEnd };
}

// ─── Shared types ─────────────────────────────────────────────────────────────

export type ChatRow = {
  _id: Id<"chats">;
  title?: string;
  updatedAt?: number;
  createdAt: number;
  isPinned?: boolean;
  pinnedAt?: number;
  folderId?: string;
  folderName?: string;
  source?: string;
  lastMessagePreview?: string;
  sourceJobName?: string;
  participantSummary: Array<{
    modelId: string;
    personaId?: Id<"personas">;
    personaName?: string;
    personaEmoji?: string;
    personaAvatarImageUrl?: string;
  }>;
};

export type FolderRow = { _id: Id<"folders">; name: string; color?: string; sortOrder?: number };

type SectionProps = {
  chats: ChatRow[];
  selectedChatId: string | null;
  folders: FolderRow[];
  isEditMode?: boolean;
  checkedIds?: Set<string>;
  onSelect: (id: string) => void;
  onPin: (id: string, isPinned: boolean) => void;
  onDelete: (id: string) => void;
  onMoveToFolder: (id: string, folderId: string | undefined) => void;
  onRename?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onEnterEditMode?: () => void;
  onToggleCheck?: (id: string) => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderChatItems(props: SectionProps) {
  return props.chats.map((chat) => (
    <ChatListItem
      key={chat._id as string}
      chat={{
        ...chat,
        _id: chat._id as string,
        participantSummary: chat.participantSummary.map((p) => ({
          ...p,
          personaId: p.personaId as string | undefined,
        })),
      }}
      isSelected={props.selectedChatId === (chat._id as string)}
      isEditMode={props.isEditMode}
      isChecked={props.checkedIds?.has(chat._id as string)}
      folders={props.folders.map((f) => ({ _id: f._id as string, name: f.name }))}
      onSelect={() => props.onSelect(chat._id as string)}
      onPin={() => props.onPin(chat._id as string, chat.isPinned ?? false)}
      onDelete={() => props.onDelete(chat._id as string)}
      onMoveToFolder={(fid) => props.onMoveToFolder(chat._id as string, fid)}
      onRename={props.onRename ? () => props.onRename!(chat._id as string) : undefined}
      onDuplicate={props.onDuplicate ? () => props.onDuplicate!(chat._id as string) : undefined}
      onEnterEditMode={props.onEnterEditMode}
      onToggleCheck={props.onToggleCheck ? () => props.onToggleCheck!(chat._id as string) : undefined}
    />
  ));
}

// ─── PinnedSection ────────────────────────────────────────────────────────────

export function PinnedSection(props: SectionProps & {
  isReorderMode?: boolean;
  onToggleReorder?: () => void;
  onReorderPinned?: (orderedIds: Id<"chats">[]) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const { renderedItems, dragIdx, overIdx, onDragStart, onDragOver, onDrop, onDragEnd } =
    useDragReorder(props.chats, (ids) => props.onReorderPinned?.(ids));

  if (props.chats.length === 0) return null;
  return (
    <div>
      <div className="flex items-center px-3 py-1">
        <button onClick={() => setExpanded((v) => !v)} className="flex items-center gap-1.5 flex-1">
          <Pin size={11} className="text-primary" />
          <span className="text-xs font-semibold text-foreground/50 uppercase tracking-wide flex-1 text-left">{t("pinned")}</span>
          {expanded ? <ChevronDown size={12} className="text-foreground/40" /> : <ChevronRight size={12} className="text-foreground/40" />}
        </button>
        {expanded && props.onToggleReorder && (
          <button
            onClick={props.onToggleReorder}
            className={cn(
              "text-xs font-medium px-2 py-0.5 rounded transition-colors",
              props.isReorderMode
                ? "text-primary"
                : "text-foreground/40 hover:text-foreground/60",
            )}
          >
            {props.isReorderMode ? t("done") : t("modify")}
          </button>
        )}
      </div>
      {expanded && (
        <div className="px-1.5 pb-1 flex flex-col gap-0.5">
          {props.isReorderMode ? (
            renderedItems.map((chat, idx) => (
              <div
                key={chat._id as string}
                draggable
                onDragStart={() => onDragStart(idx)}
                onDragOver={(e) => onDragOver(e, idx)}
                onDrop={onDrop}
                onDragEnd={onDragEnd}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-xl bg-foreground/3 transition-all",
                  dragIdx === idx && "opacity-40",
                  overIdx === idx && dragIdx !== idx && "ring-1 ring-primary/40",
                )}
              >
                <GripVertical size={14} className="text-foreground/30 cursor-grab flex-shrink-0" />
                <span className="text-sm truncate flex-1">{chat.title ?? t("new_chat")}</span>
              </div>
            ))
          ) : (
            renderChatItems(props)
          )}
        </div>
      )}
    </div>
  );
}

// ─── TimeGroupSection ─────────────────────────────────────────────────────────

export function TimeGroupSection(props: SectionProps & { label: string }) {
  const [expanded, setExpanded] = useState(true);
  if (props.chats.length === 0) return null;
  return (
    <div>
      <button onClick={() => setExpanded((v) => !v)} className="flex items-center gap-1 px-3 py-1 w-full text-left">
        <span className="text-xs font-semibold text-foreground/40 uppercase tracking-wide flex-1">{props.label}</span>
        {expanded ? <ChevronDown size={12} className="text-foreground/30" /> : <ChevronRight size={12} className="text-foreground/30" />}
      </button>
      {expanded && (
        <div className="px-1.5 pb-1 flex flex-col gap-0.5">
          {renderChatItems(props)}
        </div>
      )}
    </div>
  );
}

// ─── FilterMenu (iOS-style bottom bar filter) ─────────────────────────────────

export function FilterMenu({
  folders,
  selectedFolderId,
  showScheduledOnly,
  onSelectAll,
  onToggleScheduled,
  onSelectFolder,
  onManageFolders,
}: {
  folders: FolderRow[];
  selectedFolderId: string | null;
  showScheduledOnly: boolean;
  onSelectAll: () => void;
  onToggleScheduled: () => void;
  onSelectFolder: (folderId: string) => void;
  onManageFolders: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [folderQuery, setFolderQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const hasActiveFilter = selectedFolderId !== null || showScheduledOnly;
  const visibleFolders = folderQuery.trim()
    ? folders.filter((folder) => folder.name.toLowerCase().includes(folderQuery.trim().toLowerCase()))
    : folders;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "p-2 rounded-xl transition-colors relative",
          "hover:bg-foreground/8 text-muted hover:text-foreground",
        )}
        title="Filter chats"
        aria-label="Filter chats"
      >
        <Folder size={16} />
        {hasActiveFilter && (
          <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-2 z-50 min-w-[200px] rounded-xl bg-input border border-foreground/10 shadow-2xl py-1 max-h-72 overflow-y-auto">
            {/* All Chats */}
            <button
              onClick={() => { onSelectAll(); setOpen(false); }}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2.5 text-sm w-full text-left transition-colors",
                !hasActiveFilter
                  ? "text-primary"
                  : "text-secondary hover:bg-foreground/5",
              )}
            >
              <Folder size={14} />
              <span className="flex-1">{t("all_chats")}</span>
              {!hasActiveFilter && <Check size={14} className="text-primary" />}
            </button>

            {/* Scheduled */}
            <button
              onClick={() => { onToggleScheduled(); setOpen(false); }}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2.5 text-sm w-full text-left transition-colors",
                showScheduledOnly
                  ? "text-primary"
                  : "text-secondary hover:bg-foreground/5",
              )}
            >
              <Clock size={14} />
              <span className="flex-1">{t("scheduled")}</span>
              {showScheduledOnly && <Check size={14} className="text-primary" />}
            </button>

            {/* Divider if folders exist */}
            {folders.length > 0 && <div className="h-px bg-foreground/8 my-1" />}

            {folders.length > 8 && (
              <div className="px-2 py-1.5">
                <div className="flex items-center gap-1.5 rounded-lg bg-background/60 px-2 py-1.5">
                  <Search size={12} className="text-foreground/40" />
                  <input
                    value={folderQuery}
                    onChange={(event) => setFolderQuery(event.target.value)}
                    placeholder={t("search_placeholder")}
                    className="w-36 bg-transparent text-xs outline-none placeholder:text-foreground/30"
                  />
                </div>
              </div>
            )}

            {/* Folders */}
            {visibleFolders.map((f) => (
              <button
                key={f._id as string}
                onClick={() => { onSelectFolder(f._id as string); setOpen(false); }}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2.5 text-sm w-full text-left transition-colors",
                  selectedFolderId === (f._id as string)
                    ? "text-primary"
                    : "text-secondary hover:bg-foreground/5",
                )}
              >
                <Folder size={14} />
                <span className="truncate flex-1">{f.name}</span>
                {selectedFolderId === (f._id as string) && <Check size={14} className="text-primary" />}
              </button>
            ))}

            {/* Manage Folders */}
            <div className="h-px bg-foreground/8 my-1" />
            <button
              onClick={() => { onManageFolders(); setOpen(false); }}
              className="flex items-center gap-2.5 px-3 py-2.5 text-sm w-full text-left text-secondary hover:bg-foreground/5 transition-colors"
            >
              <FolderCog size={14} />
              <span className="flex-1">{t("manage_folders")}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── FolderManagerDialog ──────────────────────────────────────────────────────

export function FolderManagerDialog({
  isOpen,
  folders,
  activeFolderId,
  onClose,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: {
  isOpen: boolean;
  folders: FolderRow[];
  activeFolderId: string | null;
  onClose: () => void;
  onSelectFolder: (id: string | null) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showCreate) setTimeout(() => createInputRef.current?.focus(), 50);
  }, [showCreate]);

  useEffect(() => {
    if (renamingId) setTimeout(() => renameInputRef.current?.focus(), 50);
  }, [renamingId]);

  if (!isOpen) return null;

  const handleCreate = () => {
    if (createName.trim()) {
      onCreateFolder(createName.trim());
      setCreateName("");
      setShowCreate(false);
    }
  };

  const handleRename = () => {
    if (renamingId && renameName.trim()) {
      onRenameFolder(renamingId, renameName.trim());
      setRenamingId(null);
      setRenameName("");
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-80 max-h-[70vh] rounded-2xl bg-input border border-foreground/10 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/8">
          <button onClick={onClose} className="text-sm text-foreground/50 hover:text-foreground transition-colors">
            {t("close")}
          </button>
          <h3 className="font-semibold text-sm">{t("manage_folders")}</h3>
          <button
            onClick={() => setShowCreate(true)}
            className="text-primary hover:opacity-80 transition-opacity"
            title={t("new_folder")}
          >
            <FolderPlus size={18} />
          </button>
        </div>

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto">
          {/* All Chats (fixed row) */}
          <button
            onClick={() => { onSelectFolder(null); onClose(); }}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-foreground/5 transition-colors"
          >
            <Folder size={16} className="text-foreground/50" />
            <span className="flex-1 text-sm text-left">{t("all_chats")}</span>
            {activeFolderId === null && <Check size={14} className="text-primary" />}
          </button>

          {folders.map((f) => (
            <div key={f._id as string} className="group flex items-center gap-2 px-4 py-3 hover:bg-foreground/5 transition-colors">
              {renamingId === (f._id as string) ? (
                <form onSubmit={(e) => { e.preventDefault(); handleRename(); }} className="flex-1 flex items-center gap-2">
                  <input
                    ref={renameInputRef}
                    value={renameName}
                    onChange={(e) => setRenameName(e.target.value)}
                    className="flex-1 bg-background border border-foreground/12 rounded-lg px-2 py-1 text-sm outline-none focus:border-primary/50"
                    onKeyDown={(e) => { if (e.key === "Escape") { setRenamingId(null); } }}
                  />
                  <button type="submit" disabled={!renameName.trim()} className="text-xs text-primary font-medium disabled:opacity-40">{t("save")}</button>
                  <button type="button" onClick={() => setRenamingId(null)} className="text-xs text-foreground/50">{t("cancel")}</button>
                </form>
              ) : (
                <>
                  <button
                    onClick={() => { onSelectFolder(f._id as string); onClose(); }}
                    className="flex items-center gap-3 flex-1 min-w-0"
                  >
                    <Folder size={16} className="text-foreground/50 flex-shrink-0" />
                    <span className="text-sm truncate flex-1 text-left">{f.name}</span>
                    {activeFolderId === (f._id as string) && <Check size={14} className="text-primary flex-shrink-0" />}
                  </button>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setRenamingId(f._id as string); setRenameName(f.name); }}
                      className="p-1 rounded hover:bg-foreground/8 text-foreground/50"
                      title={t("rename")}
                    >
                      <PencilLine size={13} />
                    </button>
                    <button
                      onClick={() => onDeleteFolder(f._id as string)}
                      className="p-1 rounded hover:bg-red-500/10 text-red-400"
                      title={t("delete")}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}

          {folders.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-foreground/40">
              {t("no_folders_yet")}
            </div>
          )}
        </div>

        {/* Create folder inline */}
        {showCreate && (
          <div className="border-t border-foreground/8 px-4 py-3">
            <form onSubmit={(e) => { e.preventDefault(); handleCreate(); }} className="flex items-center gap-2">
              <input
                ref={createInputRef}
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={t("folder_name_placeholder")}
                className="flex-1 bg-background border border-foreground/12 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary/50"
                onKeyDown={(e) => { if (e.key === "Escape") setShowCreate(false); }}
              />
              <button type="submit" disabled={!createName.trim()} className="px-3 py-2 rounded-lg text-sm bg-primary text-white font-medium disabled:opacity-40 hover:opacity-90 transition-opacity">
                {t("create")}
              </button>
            </form>
          </div>
        )}
      </div>
    </>
  );
}

// ─── NewFolderDialog ──────────────────────────────────────────────────────────

export function NewFolderDialog({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const resetId = window.setTimeout(() => setName(""), 0);
      const focusId = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => {
        window.clearTimeout(resetId);
        window.clearTimeout(focusId);
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim()) {
      onCreate(name.trim());
      onClose();
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-72 rounded-2xl bg-input border border-foreground/10 shadow-2xl p-5">
        <h3 className="font-semibold text-sm mb-3">{t("new_folder")}</h3>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("folder_name_placeholder")}
            className="w-full bg-background border border-foreground/12 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg text-sm border border-foreground/12 hover:bg-foreground/5 transition-colors">
              {t("cancel")}
            </button>
            <button type="submit" disabled={!name.trim()} className="flex-1 py-2 rounded-lg text-sm bg-primary text-white font-medium disabled:opacity-40 hover:opacity-90 transition-opacity">
              {t("create")}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

// ─── RenameChatDialog ─────────────────────────────────────────────────────────

export function RenameChatDialog({
  isOpen,
  currentTitle,
  onClose,
  onRename,
}: {
  isOpen: boolean;
  currentTitle: string;
  onClose: () => void;
  onRename: (newTitle: string) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(currentTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const resetId = window.setTimeout(() => setTitle(currentTitle), 0);
      const focusId = window.setTimeout(() => inputRef.current?.select(), 50);
      return () => {
        window.clearTimeout(resetId);
        window.clearTimeout(focusId);
      };
    }
  }, [isOpen, currentTitle]);

  if (!isOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim()) {
      onRename(title.trim());
      onClose();
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-72 rounded-2xl bg-input border border-foreground/10 shadow-2xl p-5">
        <h3 className="font-semibold text-sm mb-3">{t("rename_chat")}</h3>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("chat_title_placeholder")}
            className="w-full bg-background border border-foreground/12 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg text-sm border border-foreground/12 hover:bg-foreground/5 transition-colors">
              {t("cancel")}
            </button>
            <button type="submit" disabled={!title.trim()} className="flex-1 py-2 rounded-lg text-sm bg-primary text-white font-medium disabled:opacity-40 hover:opacity-90 transition-opacity">
              {t("save")}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

// ─── EditModeBar ──────────────────────────────────────────────────────────────

export function EditModeBar({
  selectedCount,
  folders,
  onMoveToFolder,
  onDelete,
  onDone,
}: {
  selectedCount: number;
  folders: FolderRow[];
  onMoveToFolder: (folderId: string | undefined) => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowFolderMenu(false);
  }, []);

  useEffect(() => {
    if (showFolderMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showFolderMenu, handleClickOutside]);

  return (
    <div className="flex-shrink-0 border-t border-border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-foreground/50 font-medium">
          {t("arg_arg", { var1: selectedCount, var2: t("selected").toLowerCase() })}
        </span>
        <div className="flex items-center gap-2">
          {folders.length > 0 && (
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setShowFolderMenu((v) => !v)}
                disabled={selectedCount === 0}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface-2 hover:bg-surface-3 transition-colors disabled:opacity-40"
              >
                {t("move")}
              </button>
              {showFolderMenu && (
                <div className="absolute bottom-full right-0 mb-1 z-50 min-w-[160px] rounded-xl bg-input border border-foreground/10 shadow-2xl py-1">
                  <button
                    onClick={() => { onMoveToFolder(undefined); setShowFolderMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-foreground/5 transition-colors"
                  >
                    {t("no_folder")}
                  </button>
                  {folders.map((f) => (
                    <button
                      key={f._id as string}
                      onClick={() => { onMoveToFolder(f._id as string); setShowFolderMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-foreground/5 transition-colors"
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            onClick={onDelete}
            disabled={selectedCount === 0}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors disabled:opacity-40"
          >
            {t("delete")}
          </button>
          <button
            onClick={onDone}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-primary bg-primary/10 hover:bg-primary/15 transition-colors"
          >
            {t("done")}
          </button>
        </div>
      </div>
    </div>
  );
}
