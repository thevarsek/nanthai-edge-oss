// routes/ChatPage.tsx — Full chat view: message list, input, streaming, branching.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useChat } from "@/hooks/useChat";
import { useBranching } from "@/hooks/useBranching";
import { useMessageGrouping, messageGroupKey } from "@/hooks/useMessageGrouping";
import { useConnectedAccounts, useSharedData, useCreditBalance, useModelSummaries } from "@/hooks/useSharedData";
import { useChatOverrides } from "@/hooks/useChatOverrides";
import { useParticipants } from "@/hooks/useParticipants";
import { useAutonomous } from "@/hooks/useAutonomous";
import { useSearchSessions } from "@/hooks/useSearchSessions";
import { useChatCosts } from "@/hooks/useChatCosts";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MultiModelResponseGroup } from "@/components/chat/MultiModelResponseGroup";
import { PendingResponseGroup } from "@/components/chat/PendingResponseGroup";
import { BranchIndicator } from "@/components/chat/BranchIndicator";
import { MessageInput } from "@/components/chat/MessageInput";
import { BalanceIndicator } from "@/components/chat/BalanceIndicator";
import type { RecordingResult } from "@/hooks/useAudioRecorder";
import { AutonomousToolbar } from "@/components/chat/AutonomousToolbar";
import { SearchSessionContext } from "@/components/chat/SearchSessionContext";
import { AudioPlaybackProvider } from "@/components/chat/AudioPlaybackContext";
import { AutoAudioWatcher } from "@/components/chat/AutoAudioWatcher";
import { RenameChatDialog } from "@/components/chat-list/SidebarSections";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { ParticipantPicker } from "@/components/settings/ChatDefaultsSection.ParticipantPicker";
import { useToast } from "@/components/shared/Toast.context";
import { convexErrorMessage } from "@/lib/convexErrors";
import {
  useChatScroll, useChatSearchWiring, useMentionSuggestions, useSubagentOverride,
  useSearchMode,
} from "@/routes/ChatPage.helpers";
import { ChatHeader, EmptyChatState, ChatModalPanels } from "@/routes/ChatPage.header";
import { SlashCommandPalette, TurnOverrideChips } from "@/components/chat/SlashCommandPalette";
import { ChatSearchContext } from "@/components/chat/ChatSearchContext";
import { ChatSearchBar } from "@/components/chat/ChatSearchBar";
import { connectProviderWithPopup } from "@/lib/providerOAuth";
import {
  validateSendState as validateChatSendState,
  type SharedPreferences,
} from "@/lib/chatRequestResolution";
import type { IntegrationKey } from "@/routes/PersonaEditorForm";
import {
  attachmentsWithVideoRoles,
  buildKnowledgeBaseAttachments,
  generatedDocumentSuggestion as projectGeneratedDocumentSuggestion,
  pruneVideoRoleOverrides,
  type KnowledgeBaseAttachmentFile,
} from "@/routes/ChatPage.attachmentFlow";
import {
  resolvedBranchPath,
  shouldShowPendingResponsePlaceholder,
  visibleMessagesForPath,
} from "@/routes/ChatPage.branchFlow";
import { useDrivePickerContinuation } from "@/routes/ChatPage.drivePicker";
import {
  buildResearchPaperArgs,
  buildSendMessageArgs,
  type ChatAttachment,
  type ChatVideoRole,
} from "@/routes/ChatPage.sendFlow";
import { buildRegeneratePaperArgs } from "@/routes/ChatPage.searchFlow";
import {
  buildRetryMessageArgs,
  retryBaseParticipantForMessage,
  retryGoogleIntegrationsAreActive,
  retryParticipantWithModel,
  retryParticipantWithPersona,
} from "@/routes/ChatPage.retryFlow";
import { useChatParticipantsConfig } from "@/routes/ChatPage.participantsConfig";
import { ChatPageView } from "@/routes/ChatPage.view";

export function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { prefs, modelSettings, proStatus, personas } = useSharedData();
  const { toast } = useToast();
  const { googleConnection, gmailManualConnection, microsoftConnection, notionConnection, slackConnection, appleCalendarConnection, clozeConnection } = useConnectedAccounts();
  const { balance: creditBalance, refresh: refreshCreditBalance } = useCreditBalance();
  const typedChatId = chatId as Id<"chats"> | undefined;
  const typedPrefs = prefs as SharedPreferences | undefined;
  const isPro = !!(proStatus as { isPro?: boolean } | undefined)?.isPro;
  const showAdvancedStats = typedPrefs?.showAdvancedStats === true;
  const { messageCosts, totalCost, breakdown } = useChatCosts(typedChatId, showAdvancedStats);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { participants: convexParticipants, addParticipant, removeParticipant: removeParticipantMut, setParticipants: setParticipantsMut } = useParticipants(typedChatId);
  const connectedProviders = useMemo(
    () => ({
      gmail: gmailManualConnection?.status === "active",
      google: !!googleConnection,
      microsoft: !!microsoftConnection,
      apple: !!appleCalendarConnection,
      notion: !!notionConnection,
      cloze: clozeConnection?.status === "active",
      slack: !!slackConnection,
    }),
    [gmailManualConnection, googleConnection, microsoftConnection, appleCalendarConnection, notionConnection, clozeConnection, slackConnection],
  );
  const { chat, messages, isLoading, isGenerating, sendMessage, cancelGeneration, retryMessage, updateChat, switchBranchAtFork } = useChat(typedChatId ?? null);
  const activePersona = useMemo(() => {
    const participantPersonaId = convexParticipants.find((participant) => participant.personaId)?.personaId;
    if (participantPersonaId) {
      return (personas ?? []).find((persona) => persona._id === participantPersonaId) ?? null;
    }
    return null;
  }, [convexParticipants, personas]);
  const overrides = useChatOverrides({
    chat,
    chatId: typedChatId,
    activePersona,
    updateChat,
  });
  const [showSlashPalette, setShowSlashPalette] = useState(false);
  const handleComposerTextChange = useCallback((text: string) => {
    setShowSlashPalette(text === "/");
  }, []);
  const [slashSkillNames, setSlashSkillNames] = useState<Map<string, string>>(new Map());
  const handleSlashSelectSkill = useCallback((skillId: Id<"skills">, skillName: string) => {
    overrides.addTurnSkillOverride(skillId, "always");
    setSlashSkillNames((prev) => new Map(prev).set(skillId, skillName));
    setShowSlashPalette(false);
  }, [overrides]);
  const handleIntegrationToggle = useCallback(async (key: IntegrationKey) => {
    const alreadyEnabled = overrides.enabledIntegrations.has(key);
    if (alreadyEnabled) {
      overrides.toggleIntegration(key);
      return;
    }

    if (key === "gmail") {
      if (gmailManualConnection?.status !== "active") {
        toast({
          message: t("connect_gmail_app_password_first"),
          variant: "error",
        });
        return;
      }
    }

    if (key === "drive" || key === "calendar") {
      const capabilityGranted =
        (key === "drive" && googleConnection?.hasDrive) ||
        (key === "calendar" && googleConnection?.hasCalendar);
      if (!capabilityGranted) {
        try {
          await connectProviderWithPopup("google", { requestedIntegration: key });
        } catch (error) {
          toast({
            message: convexErrorMessage(error, t("google_signin_failed")),
            variant: "error",
          });
          return;
        }
      }
    }

    overrides.toggleIntegration(key);
  }, [gmailManualConnection?.status, googleConnection, overrides, t, toast]);
  const handleSlashSelectIntegration = useCallback(async (key: IntegrationKey) => {
    if (key === "gmail" && gmailManualConnection?.status !== "active") {
      toast({ message: t("connect_gmail_app_password_first"), variant: "error" });
      return;
    }
    if (key === "drive" || key === "calendar") {
      const capabilityGranted =
        (key === "drive" && googleConnection?.hasDrive) ||
        (key === "calendar" && googleConnection?.hasCalendar);
      if (!capabilityGranted) {
        try {
          await connectProviderWithPopup("google", { requestedIntegration: key });
        } catch (error) {
          toast({ message: convexErrorMessage(error, t("google_signin_failed")), variant: "error" });
          return;
        }
      }
    }
    overrides.addTurnIntegrationOverride(key, true);
    setShowSlashPalette(false);
  }, [gmailManualConnection?.status, googleConnection, overrides, t, toast]);
  const hasConnectedIntegrations = Object.values(connectedProviders).some(Boolean);

  const { activePath, branchNodes, navigate: navigateBranch, optimisticLeafId, setOptimisticLeafId } = useBranching(messages, {
    activeLeafId: chat?.activeBranchLeafId,
  });
  const resolvedPath = useMemo(
    () => resolvedBranchPath(messages, activePath),
    [activePath, messages],
  );
  const visibleMessages = useMemo(
    () => visibleMessagesForPath(messages, resolvedPath),
    [messages, resolvedPath],
  );
  const groupedMessages = useMessageGrouping(visibleMessages);
  const {
    scrollContainerRef: chatSearchScrollContainerRef,
    searchCtx: chatSearchCtx,
    isOpen: chatSearchIsOpen,
    query: chatSearchQuery,
    setQuery: setChatSearchQuery,
    matches: chatSearchMatches,
    currentIndex: chatSearchCurrentIndex,
    next: chatSearchNext,
    prev: chatSearchPrev,
    close: closeChatSearch,
  } = useChatSearchWiring(visibleMessages, chatId);
  const showPendingResponsePlaceholder = shouldShowPendingResponsePlaceholder({ isGenerating, visibleMessages });

  // Auto-refresh credit balance when generation completes (true → false transition)
  const prevIsGeneratingRef = useRef(false);
  useEffect(() => {
    if (prevIsGeneratingRef.current && !isGenerating) {
      void refreshCreditBalance();
    }
    prevIsGeneratingRef.current = isGenerating;
  }, [isGenerating, refreshCreditBalance]);

  const createChat = useMutation(api.chat.mutations.createChat);
  const createUploadUrl = useMutation(api.chat.mutations.createUploadUrl);
  const getDrivePickerAccessToken = useAction(api.oauth.google.getDrivePickerAccessToken);
  const attachPickedDriveFiles = useAction(api.drive_picker.actions.attachPickedDriveFiles);
  const forkChat = useMutation(api.chat.manage.forkChat);
  const selectedKBStorageIds = useMemo(
    () => Array.from(overrides.selectedKBFileIds) as Id<"_storage">[],
    [overrides.selectedKBFileIds],
  );
  const selectedKBFiles = useQuery(
    api.knowledge_base.queries.getKnowledgeBaseFilesByStorageIds,
    selectedKBStorageIds.length > 0 ? { storageIds: selectedKBStorageIds } : "skip",
  ) as KnowledgeBaseAttachmentFile[] | undefined;
  useChatScroll(messagesEndRef, visibleMessages.length, isGenerating, chatId);
  const { sessionMap } = useSearchSessions(typedChatId);
  const cancelSession = useMutation(api.search.mutations.cancelResearchPaper);
  const regeneratePaper = useMutation(api.search.mutations.regeneratePaper);

  const modelSummaries = useModelSummaries();
  const {
    participants,
    paramDefaults,
    allParticipantsSupportTools,
    isVideoMode,
    supportsFrameImages,
    googleIntegrationsBlocked,
    isMultiModel,
  } = useChatParticipantsConfig({
    convexParticipants,
    personas,
    prefs: typedPrefs,
    modelSettings: modelSettings ?? undefined,
    modelSummaries: modelSummaries ?? undefined,
    parameterOverrides: overrides.paramOverrides,
  });

  const { subagentOverride, effectiveSubagentsEnabled, handleSubagentOverrideChange } = useSubagentOverride({
    chat, participantCount: participants.length, isPro,
    subagentsEnabledByDefault: typedPrefs?.subagentsEnabledByDefault ?? false,
    chatId: typedChatId, updateChat,
  });
  const { searchMode, setSearchMode: setSearchModeOverride, globeColor } = useSearchMode({
    chat, chatId: typedChatId, updateChat,
    webSearchEnabledByDefault: typedPrefs?.webSearchEnabledByDefault ?? true,
    defaultSearchMode: typedPrefs?.defaultSearchMode,
    defaultSearchComplexity: typedPrefs?.defaultSearchComplexity,
  });
  // Derive sendMessage args from search mode state
  const webSearchEnabled = searchMode.mode !== "none";
  const convexSearchMode: "normal" | "web" | undefined = searchMode.mode === "basic" ? "normal" : searchMode.mode === "web" ? "web" : undefined;
  const convexComplexity: number | undefined = (searchMode.mode === "web" || searchMode.mode === "paper") ? searchMode.complexity : undefined;
  const isResearchPaper = searchMode.mode === "paper";
  const [showRename, setShowRename] = useState(false);
  const [retryDifferentMessageId, setRetryDifferentMessageId] = useState<Id<"messages"> | null>(null);
  const [hasShownChatSkeleton, setHasShownChatSkeleton] = useState(false);
  const handleRename = useCallback((newTitle: string) => {
    if (typedChatId) void updateChat({ chatId: typedChatId, title: newTitle } as Parameters<typeof updateChat>[0]);
  }, [typedChatId, updateChat]);
  const handleToggleIdeascape = useCallback(() => {
    if (typedChatId) navigate(`/app/ideascape/${typedChatId}`);
  }, [typedChatId, navigate]);

  const handleBranchNavigate = useCallback((messageId: Id<"messages">, direction: "prev" | "next") => {
    if (!typedChatId) return;
    const selection = navigateBranch(messageId, direction);
    if (!selection) return;
    setOptimisticLeafId(selection.optimisticLeafId);
    void switchBranchAtFork({
      chatId: typedChatId,
      currentSiblingMessageId: selection.currentSiblingId,
      targetSiblingMessageId: selection.targetSiblingId,
    }).then((nextLeafId) => {
      setOptimisticLeafId(nextLeafId);
    }).catch(() => {
      setOptimisticLeafId(undefined);
    });
  }, [navigateBranch, setOptimisticLeafId, typedChatId, switchBranchAtFork]);

  useEffect(() => {
    if (optimisticLeafId && optimisticLeafId === chat?.activeBranchLeafId) {
      setOptimisticLeafId(undefined);
    }
  }, [chat?.activeBranchLeafId, optimisticLeafId, setOptimisticLeafId]);

  const hasMessages = visibleMessages.length > 0;
  const autonomous = useAutonomous({ chatId: typedChatId, participants, hasMessages, isPro });
  const isAutonomousActive = autonomous.state.status === "active" || autonomous.state.status === "paused";

  const ensureChatId = useCallback(async () => {
    if (typedChatId) return typedChatId;
    const newId = await createChat({
      mode: "chat",
      participants,
    });
    navigate(`/app/chat/${newId}`, { replace: true });
    return newId;
  }, [typedChatId, createChat, navigate, participants]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (typedChatId) {
        setHasShownChatSkeleton(true);
        return;
      }
      setHasShownChatSkeleton(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [typedChatId]);

  const turnOverrideArgs = useMemo(() => ({
    ...(overrides.turnSkillOverrideEntries.length > 0 ? { turnSkillOverrides: overrides.turnSkillOverrideEntries } : {}),
    ...(overrides.turnIntegrationOverrideEntries.length > 0 ? { turnIntegrationOverrides: overrides.turnIntegrationOverrideEntries } : {}),
  }), [overrides.turnSkillOverrideEntries, overrides.turnIntegrationOverrideEntries]);
  const handleCancelSession = useCallback(
    (sessionId: string) => { void cancelSession({ sessionId: sessionId as Id<"searchSessions"> }); },
    [cancelSession],
  );
  const handleRegeneratePaper = useCallback(
    (sessionId: string) => {
      const participant = participants[0];
      if (!participant) return;
      void regeneratePaper(buildRegeneratePaperArgs({
        sessionId,
        participant,
        enabledIntegrations: overrides.enabledIntegrations,
      }));
    },
    [overrides.enabledIntegrations, participants, regeneratePaper],
  );
  const searchSessionCtx = useMemo(
    () => ({ sessionMap, onCancel: handleCancelSession, onRegenerate: handleRegeneratePaper }),
    [handleCancelSession, handleRegeneratePaper, sessionMap],
  );
  const kbAttachments = useMemo(
    () => buildKnowledgeBaseAttachments(selectedKBFiles),
    [selectedKBFiles],
  );

  // Per-KB-file video role overrides, keyed by storageId. Local state because
  // KB query results don't track per-turn video roles.
  const [kbVideoRoles, setKbVideoRoles] = useState<Record<string, ChatVideoRole>>({});
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKbVideoRoles((prev) => pruneVideoRoleOverrides(prev, kbAttachments));
  }, [kbAttachments]);
  const effectiveKbVideoRoles = useMemo(
    () => pruneVideoRoleOverrides(kbVideoRoles, kbAttachments),
    [kbAttachments, kbVideoRoles],
  );

  /** KB attachments enriched with default video roles when in video mode. */
  const kbAttachmentsForDisplay = useMemo(
    () => attachmentsWithVideoRoles({
      attachments: kbAttachments,
      roleOverrides: effectiveKbVideoRoles,
      isVideoMode,
      supportsFrameImages,
    }),
    [effectiveKbVideoRoles, isVideoMode, kbAttachments, supportsFrameImages],
  );

  const generatedDocumentSuggestion = useMemo(
    () => projectGeneratedDocumentSuggestion(visibleMessages),
    [visibleMessages],
  );

  const startResearchPaper = useMutation(api.search.mutations.startResearchPaper);

  const validateSendState = useCallback((attachmentCount: number) => {
    const message = validateChatSendState({
      participantCount: participants.length,
      isResearchPaper,
      attachmentCount,
      complexity: convexComplexity,
    });
    if (message) {
      toast({ message, variant: "error" });
      return false;
    }
    return true;
  }, [convexComplexity, isResearchPaper, participants.length, toast]);

  const handleSend = useCallback(
    async ({ text, attachments }: { text: string; attachments?: ChatAttachment[] }) => {
      const cid = await ensureChatId();
      await overrides.flushPendingState(cid);
      const mergedAttachments: ChatAttachment[] = [...(attachments ?? []), ...kbAttachmentsForDisplay];
      if (!validateSendState(mergedAttachments.length)) return;
      if (isResearchPaper) {
        const participant = participants[0];
        if (!participant) return;
        // Research Paper uses a separate mutation with single participant
        await startResearchPaper(buildResearchPaperArgs({
          chatId: cid,
          text,
          participant,
          complexity: convexComplexity ?? 1,
          attachments: mergedAttachments,
          enabledIntegrations: overrides.enabledIntegrations,
        }));
      } else {
        await sendMessage(buildSendMessageArgs({
          chatId: cid,
          text,
          participants,
          attachments: mergedAttachments,
          turnOverrideArgs,
          enabledIntegrations: overrides.enabledIntegrations,
          subagentsEnabled: effectiveSubagentsEnabled,
          webSearchEnabled,
          convexSearchMode,
          convexComplexity,
          isVideoMode,
          prefs: typedPrefs,
        }));
      }
      overrides.clearKBFiles();
      overrides.clearTurnOverrides();
    },
    [ensureChatId, kbAttachmentsForDisplay, sendMessage, startResearchPaper, participants, turnOverrideArgs, effectiveSubagentsEnabled, webSearchEnabled, convexSearchMode, convexComplexity, isResearchPaper, isVideoMode, typedPrefs, overrides, validateSendState],
  );

  useDrivePickerContinuation({
    visibleMessages,
    hasGoogleDriveConnection: googleConnection?.hasDrive === true,
    getDrivePickerAccessToken,
    attachPickedDriveFiles,
    toast,
    t,
  });

  const handleSendRecording = useCallback(
    async (result: RecordingResult) => {
      const cid = await ensureChatId();
      await overrides.flushPendingState(cid);
      const uploadUrl = await createUploadUrl({});
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": result.mimeType }, body: result.blob });
      if (!res.ok) return;
      const { storageId } = (await res.json()) as { storageId: string };
      const mergedAttachments: ChatAttachment[] = [...kbAttachmentsForDisplay];
      if (!validateSendState(mergedAttachments.length)) return;
      if (isResearchPaper) {
        const participant = participants[0];
        if (!participant) return;
        await startResearchPaper(buildResearchPaperArgs({
          chatId: cid,
          text: result.transcript || "(voice message)",
          participant,
          complexity: convexComplexity ?? 1,
          attachments: mergedAttachments,
          recordedAudio: { storageId: storageId as Id<"_storage">, transcript: result.transcript, durationMs: result.durationMs, mimeType: result.mimeType },
          enabledIntegrations: overrides.enabledIntegrations,
        }));
      } else {
        await sendMessage(buildSendMessageArgs({
          chatId: cid,
          text: result.transcript || "(voice message)",
          participants,
          attachments: mergedAttachments,
          recordedAudio: { storageId: storageId as Id<"_storage">, transcript: result.transcript, durationMs: result.durationMs, mimeType: result.mimeType },
          turnOverrideArgs,
          enabledIntegrations: overrides.enabledIntegrations,
          subagentsEnabled: effectiveSubagentsEnabled,
          webSearchEnabled,
          convexSearchMode,
          convexComplexity,
          isVideoMode,
          prefs: typedPrefs,
        }));
      }
      overrides.clearKBFiles();
    },
    [ensureChatId, createUploadUrl, sendMessage, startResearchPaper, participants, effectiveSubagentsEnabled, webSearchEnabled, convexSearchMode, convexComplexity, isResearchPaper, isVideoMode, typedPrefs, overrides, kbAttachmentsForDisplay, validateSendState, turnOverrideArgs],
  );

  const retryTargetMessage = useMemo(
    () => retryDifferentMessageId
      ? messages.find((message) => message._id === retryDifferentMessageId)
      : undefined,
    [messages, retryDifferentMessageId],
  );
  const retryBaseParticipant = useMemo(
    () => retryBaseParticipantForMessage(retryTargetMessage),
    [retryTargetMessage],
  );
  const retryGoogleIntegrationsActive = useMemo(
    () => retryGoogleIntegrationsAreActive(retryTargetMessage),
    [retryTargetMessage],
  );

  const handleCancel = useCallback(() => { if (typedChatId) void cancelGeneration({ chatId: typedChatId }); }, [typedChatId, cancelGeneration]);
  const handleRetry = useCallback((messageId: Id<"messages">) => {
    const targetMessage = messages.find((message) => message._id === messageId);
    void retryMessage(buildRetryMessageArgs({
      messageId,
      targetMessage,
      convexSearchMode,
      convexComplexity,
      enabledIntegrations: overrides.enabledIntegrations,
      turnSkillOverrideEntries: overrides.turnSkillOverrideEntries,
      turnIntegrationOverrideEntries: overrides.turnIntegrationOverrideEntries,
      effectiveSubagentsEnabled,
    }));
  }, [
    convexComplexity,
    convexSearchMode,
    effectiveSubagentsEnabled,
    messages,
    overrides.enabledIntegrations,
    overrides.turnIntegrationOverrideEntries,
    overrides.turnSkillOverrideEntries,
    retryMessage,
  ]);
  const handleRetryWithDifferentModel = useCallback((messageId: Id<"messages">) => {
    setRetryDifferentMessageId(messageId);
  }, []);
  const handleSelectRetryModel = useCallback((modelId: string) => {
    if (!retryDifferentMessageId) return;
    void retryMessage({
      messageId: retryDifferentMessageId,
      participants: [retryParticipantWithModel(retryBaseParticipant, modelId)],
    });
    setRetryDifferentMessageId(null);
  }, [retryBaseParticipant, retryDifferentMessageId, retryMessage]);
  const handleSelectRetryPersona = useCallback((personaId: string) => {
    if (!retryDifferentMessageId) return;
    void retryMessage({
      messageId: retryDifferentMessageId,
      participants: [retryParticipantWithPersona({
        baseParticipant: retryBaseParticipant,
        personaId,
        personas,
      })],
    });
    setRetryDifferentMessageId(null);
  }, [retryBaseParticipant, retryDifferentMessageId, retryMessage, personas]);
  const handleFork = useCallback(async (messageId: Id<"messages">) => {
    if (!typedChatId) return;
    navigate(`/app/chat/${await forkChat({ chatId: typedChatId, atMessageId: messageId })}`);
  }, [typedChatId, forkChat, navigate]);
  const handleJumpToNext = useCallback((targetMessageId: Id<"messages">) => {
    const el = chatSearchScrollContainerRef.current?.querySelector(
      `[data-message-id="${targetMessageId}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [chatSearchScrollContainerRef]);

  const mentionSuggestions = useMentionSuggestions(participants);

  if (typedChatId && isLoading && !hasShownChatSkeleton) {
    return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;
  }

  return (
    <ChatPageView
      header={<ChatHeader
        title={chat?.title ?? ""} onBack={() => navigate("/app")} participants={participants}
        isPro={isPro} onRename={() => setShowRename(true)} searchMode={searchMode}
        globeColor={globeColor}
        onSetSearchMode={(s) => void setSearchModeOverride(s)}
        isMultiModel={isMultiModel} onToggleIdeascape={handleToggleIdeascape}
        totalCost={totalCost} showAdvancedStats={showAdvancedStats} breakdown={breakdown}
      />}
      messageArea={<AudioPlaybackProvider defaultAudioSpeed={typedPrefs?.defaultAudioSpeed}>
        <AutoAudioWatcher messages={visibleMessages} isLoading={isLoading} />
          <ChatSearchContext.Provider value={chatSearchCtx}>
          <SearchSessionContext.Provider value={searchSessionCtx}>
          {chatSearchIsOpen && (
            <ChatSearchBar
              query={chatSearchQuery}
              onQueryChange={setChatSearchQuery}
              matchCount={chatSearchMatches.length}
              currentIndex={chatSearchCurrentIndex}
              onNext={chatSearchNext}
              onPrev={chatSearchPrev}
              onClose={closeChatSearch}
            />
          )}
          <div ref={chatSearchScrollContainerRef} className="h-full overflow-y-auto px-4 py-4 space-y-4">
            {visibleMessages.length === 0 ? <EmptyChatState /> : groupedMessages.map((group) =>
              group.type === "single" ? (
                <div key={group.message._id} data-message-id={group.message._id}>
                  {branchNodes.has(group.message._id) && <BranchIndicator node={branchNodes.get(group.message._id)!} onNavigate={handleBranchNavigate} onJumpToNext={handleJumpToNext} />}
                  <MessageBubble message={group.message} isStreaming={isGenerating && group.message.status === "streaming"} participants={participants} onRetry={handleRetry} onFork={handleFork} onRetryWithDifferentModel={handleRetryWithDifferentModel} messageCost={messageCosts[group.message._id]} showAdvancedStats={showAdvancedStats} />
                </div>
              ) : (
                <div key={messageGroupKey(group)} data-message-id={group.messages[0]?._id}>
                  {group.messages[0] && branchNodes.has(group.messages[0]._id) && <BranchIndicator node={branchNodes.get(group.messages[0]._id)!} onNavigate={handleBranchNavigate} onJumpToNext={handleJumpToNext} />}
                  <MultiModelResponseGroup groupId={group.groupId} messages={group.messages} isStreaming={isGenerating} participants={participants} onRetry={handleRetry} onFork={handleFork} onRetryWithDifferentModel={handleRetryWithDifferentModel} messageCosts={messageCosts} showAdvancedStats={showAdvancedStats} />
                </div>
              ),
            )}
            {showPendingResponsePlaceholder && visibleMessages.length > 0 && (
              <PendingResponseGroup participants={participants} />
            )}
            <div ref={messagesEndRef} />
          </div>
          </SearchSessionContext.Provider>
          </ChatSearchContext.Provider>
        </AudioPlaybackProvider>}
      autonomousToolbar={<AutonomousToolbar state={autonomous.state} onPause={autonomous.pause} onResume={autonomous.resume} onStop={autonomous.stop} onDismiss={autonomous.dismissEnded} />}
      balanceIndicator={typedPrefs?.showBalanceInChat === true ? <BalanceIndicator balance={creditBalance} /> : null}
      turnOverrideChips={<TurnOverrideChips
        turnSkillOverrides={overrides.turnSkillOverrides}
        turnIntegrationOverrides={overrides.turnIntegrationOverrides}
        onRemoveSkill={overrides.removeTurnSkillOverride}
        onRemoveIntegration={overrides.removeTurnIntegrationOverride}
        skillNames={slashSkillNames}
      />}
      composerPalette={showSlashPalette ? (
          <SlashCommandPalette
            onSelectSkill={handleSlashSelectSkill}
            onSelectIntegration={handleSlashSelectIntegration}
            onDismiss={() => setShowSlashPalette(false)}
            turnSkillOverrides={overrides.turnSkillOverrides}
            turnIntegrationOverrides={overrides.turnIntegrationOverrides}
            connectedProviders={connectedProviders}
          />
        ) : null}
      composer={<MessageInput
        chatId={typedChatId ?? ("" as Id<"chats">)} participants={participants} isGenerating={isGenerating}
        onSend={handleSend} onCancel={handleCancel} onCreateUploadUrl={() => createUploadUrl({})}
        onPlusMenuSelect={overrides.handlePlusMenuSelect} plusMenuBadges={overrides.badges} isPro={isPro}
        hasConnectedIntegrations={hasConnectedIntegrations} participantCount={participants.length} hasMessages={hasMessages}
        mentionSuggestions={mentionSuggestions} disabled={false} isAutonomousActive={isAutonomousActive}
        onIntervene={autonomous.intervene} onSendRecording={handleSendRecording}
        allParticipantsSupportTools={allParticipantsSupportTools}
        isVideoMode={isVideoMode}
        supportsFrameImages={supportsFrameImages}
        onTextChange={handleComposerTextChange}
        extraAttachments={kbAttachmentsForDisplay}
        generatedDocumentSuggestion={generatedDocumentSuggestion}
        onRemoveExtra={(i) => {
          const sid = kbAttachmentsForDisplay[i]?.storageId;
          if (sid) overrides.toggleKBFile(sid);
        }}
        onChangeExtraRole={(i, role) => {
          const sid = kbAttachmentsForDisplay[i]?.storageId;
          if (sid) setKbVideoRoles((prev) => ({ ...prev, [sid]: role }));
        }}
      />}
      modalPanels={<ChatModalPanels
        activePanel={overrides.activePanel} closePanel={overrides.closePanel}
        paramOverrides={overrides.paramOverrides} setParamOverrides={overrides.setParamOverrides} paramDefaults={paramDefaults}
        enabledIntegrations={overrides.enabledIntegrations} toggleIntegration={(key) => { void handleIntegrationToggle(key); }} connectedProviders={connectedProviders} googleIntegrationsBlocked={googleIntegrationsBlocked}
        enabledSkillIds={overrides.enabledSkillIds} toggleSkill={overrides.toggleSkill}
        skillOverrides={overrides.skillOverrides} cycleSkill={overrides.cycleSkill}
        selectedKBFileIds={overrides.selectedKBFileIds} toggleKBFile={overrides.toggleKBFile}
        chatId={typedChatId} convexParticipants={convexParticipants}
        addParticipant={addParticipant} removeParticipant={removeParticipantMut} setParticipants={setParticipantsMut}
        subagentOverride={subagentOverride} effectiveSubagentsEnabled={effectiveSubagentsEnabled}
        isPro={isPro} handleSubagentOverrideChange={handleSubagentOverrideChange}
        autonomousSettings={autonomous.settings} onAutonomousSettingsChange={autonomous.setSettings}
        participants={participants} hasMessages={hasMessages} onAutonomousStart={autonomous.start}
      />}
      renameDialog={<RenameChatDialog isOpen={showRename} currentTitle={chat?.title ?? ""} onClose={() => setShowRename(false)} onRename={handleRename} />}
      retryPicker={retryDifferentMessageId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setRetryDifferentMessageId(null)} />
          <div className="relative w-full max-w-lg max-h-[80vh] rounded-2xl overflow-hidden shadow-2xl bg-background border border-border/50">
            <ParticipantPicker
              title={t("retry_with")}
              selectedPersonaId={retryBaseParticipant.personaId ?? null}
              selectedModelId={retryBaseParticipant.modelId}
              onSelectPersona={handleSelectRetryPersona}
              onSelectModel={handleSelectRetryModel}
              onClose={() => setRetryDifferentMessageId(null)}
              googleIntegrationsActive={retryGoogleIntegrationsActive}
            />
          </div>
        </div>
      ) : null}
    />
  );
}
