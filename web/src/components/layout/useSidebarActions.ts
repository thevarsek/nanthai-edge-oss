import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ChatRow } from "@/components/chat-list/SidebarSections";
import { useToast } from "@/components/shared/Toast.context";
import { useSharedData } from "@/hooks/useSharedData";
import { buildDefaultParticipants, launchChat, type PersonaLike } from "@/lib/chatLaunch";
import { Defaults } from "@/lib/constants";

interface UseSidebarActionsOptions {
  activeFolderId?: string;
  chats: ChatRow[];
  clearDeletedFolder: (folderId: string) => void;
}

export function useSidebarActions({
  activeFolderId,
  chats,
  clearDeletedFolder,
}: UseSidebarActionsOptions) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { chatId: selectedChatId } = useParams<{ chatId: string }>();
  const { favorites, prefs, personas } = useSharedData();
  const [isEditMode, setIsEditMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [isPinnedReorderMode, setIsPinnedReorderMode] = useState(false);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [isFolderManagerOpen, setIsFolderManagerOpen] = useState(false);
  const isCreatingChatRef = useRef(false);

  const createChat = useMutation(api.chat.mutations.createChat);
  const deleteChatMutation = useMutation(api.chat.manage.deleteChat);
  const updateChat = useMutation(api.chat.manage.updateChat);
  const moveChat = useMutation(api.folders.mutations.moveChat);
  const createFolderMutation = useMutation(api.folders.mutations.create);
  const renameFolderMutation = useMutation(api.folders.mutations.update);
  const deleteFolderMutation = useMutation(api.folders.mutations.remove);
  const duplicateChat = useMutation(api.chat.manage.duplicateChat);
  const bulkDeleteChats = useMutation(api.chat.manage.bulkDeleteChats);
  const bulkMoveChats = useMutation(api.chat.manage.bulkMoveChats);
  const reorderPinnedChats = useMutation(api.chat.manage.reorderPinnedChats);

  const createNewChat = useCallback(async () => {
    if (isCreatingChatRef.current) return;
    isCreatingChatRef.current = true;
    setIsCreatingChat(true);
    try {
      const participants = buildDefaultParticipants({
        prefs: prefs as { defaultModelId?: string; defaultPersonaId?: string } | undefined,
        personas: (personas ?? []) as PersonaLike[],
        fallbackModelId: Defaults.model,
      });
      const chatId = await launchChat({
        createChat,
        participants,
        folderId: activeFolderId,
      });
      navigate(`/app/chat/${chatId}`);
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : t("something_went_wrong"),
        variant: "error",
      });
    } finally {
      isCreatingChatRef.current = false;
      setIsCreatingChat(false);
    }
  }, [activeFolderId, createChat, navigate, personas, prefs, t, toast]);

  const selectChat = useCallback(
    (id: string) => navigate(`/app/chat/${id}`),
    [navigate],
  );
  const pinChat = useCallback(async (id: string, currentlyPinned: boolean) => {
    await updateChat({ chatId: id as Id<"chats">, isPinned: !currentlyPinned });
  }, [updateChat]);
  const deleteChat = useCallback(async (id: string) => {
    if (selectedChatId === id) navigate("/app");
    await deleteChatMutation({ chatId: id as Id<"chats"> });
  }, [deleteChatMutation, navigate, selectedChatId]);
  const moveToFolder = useCallback(async (id: string, folderId: string | undefined) => {
    await moveChat({
      chatId: id as Id<"chats">,
      folderId: folderId as Id<"folders"> | undefined,
    });
  }, [moveChat]);
  const createFolder = useCallback(async (name: string) => {
    await createFolderMutation({ name });
  }, [createFolderMutation]);
  const renameFolder = useCallback(async (id: string, name: string) => {
    await renameFolderMutation({ folderId: id as Id<"folders">, name });
  }, [renameFolderMutation]);
  const deleteFolder = useCallback(async (id: string) => {
    await deleteFolderMutation({ folderId: id as Id<"folders"> });
    clearDeletedFolder(id);
  }, [clearDeletedFolder, deleteFolderMutation]);
  const duplicate = useCallback(async (id: string) => {
    const newChatId = await duplicateChat({ chatId: id as Id<"chats"> });
    navigate(`/app/chat/${newChatId}`);
  }, [duplicateChat, navigate]);
  const startRename = useCallback((id: string) => {
    const chat = chats.find((candidate) => (candidate._id as string) === id);
    setRenamingChatId(id);
    setRenamingTitle(chat?.title ?? t("new_chat"));
  }, [chats, t]);
  const renameChat = useCallback(async (newTitle: string) => {
    if (renamingChatId) {
      await updateChat({ chatId: renamingChatId as Id<"chats">, title: newTitle });
    }
  }, [renamingChatId, updateChat]);
  const toggleCheck = useCallback((id: string) => {
    setCheckedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const bulkDelete = useCallback(async () => {
    if (checkedIds.size === 0) return;
    await bulkDeleteChats({ chatIds: Array.from(checkedIds) as Id<"chats">[] });
    if (selectedChatId && checkedIds.has(selectedChatId)) navigate("/app");
    setCheckedIds(new Set());
    setIsEditMode(false);
  }, [bulkDeleteChats, checkedIds, navigate, selectedChatId]);
  const bulkMove = useCallback(async (folderId: string | undefined) => {
    if (checkedIds.size === 0) return;
    await bulkMoveChats({
      chatIds: Array.from(checkedIds) as Id<"chats">[],
      folderId,
    });
    setCheckedIds(new Set());
    setIsEditMode(false);
  }, [bulkMoveChats, checkedIds]);
  const reorderPinned = useCallback(async (orderedIds: Id<"chats">[]) => {
    await reorderPinnedChats({ orderedChatIds: orderedIds });
  }, [reorderPinnedChats]);
  const enterEditMode = useCallback(() => {
    setIsEditMode(true);
    setCheckedIds(new Set());
  }, []);
  const finishEditing = useCallback(() => {
    setIsEditMode(false);
    setCheckedIds(new Set());
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "n" && !event.shiftKey) {
        event.preventDefault();
        void createNewChat();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createNewChat]);

  const sectionActions = useMemo(() => ({
    checkedIds,
    isEditMode,
    onDelete: deleteChat,
    onDuplicate: duplicate,
    onEnterEditMode: enterEditMode,
    onMoveToFolder: moveToFolder,
    onPin: pinChat,
    onRename: startRename,
    onSelect: selectChat,
    onToggleCheck: toggleCheck,
    selectedChatId: selectedChatId ?? null,
  }), [
    checkedIds, deleteChat, duplicate, enterEditMode, isEditMode, moveToFolder,
    pinChat, selectChat, selectedChatId, startRename, toggleCheck,
  ]);

  return {
    bulkDelete,
    bulkMove,
    checkedIds,
    closeFolderManager: () => setIsFolderManagerOpen(false),
    closeNewFolder: () => setIsNewFolderOpen(false),
    closeRename: () => setRenamingChatId(null),
    createFolder,
    createNewChat,
    deleteFolder,
    finishEditing,
    hasFavorites: (favorites ?? []).length > 0,
    isCreatingChat,
    isEditMode,
    isFolderManagerOpen,
    isNewFolderOpen,
    isPinnedReorderMode,
    isRenameOpen: Boolean(renamingChatId),
    openFolderManager: () => setIsFolderManagerOpen(true),
    renameChat,
    renameFolder,
    renamingTitle,
    reorderPinned,
    sectionActions,
    togglePinnedReorder: () => setIsPinnedReorderMode((current) => !current),
  };
}
