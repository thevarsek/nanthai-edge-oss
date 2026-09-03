// routes/ChatPage.tsx — Full chat view: message list, input, streaming, branching.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useChat, type Message, type PresentationContext } from "@/hooks/useChat";
import { useBranching } from "@/hooks/useBranching";
import { useMessageGrouping, messageGroupKey } from "@/hooks/useMessageGrouping";
import { useConnectedAccounts, useSharedData, useCreditBalance, useModelSummaries } from "@/hooks/useSharedData";
import { useChatOverrides } from "@/hooks/useChatOverrides";
import { useParticipants } from "@/hooks/useParticipants";
import { useAutonomous } from "@/hooks/useAutonomous";
import { useCollaboration } from "@/hooks/useCollaboration";
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
import { CollaborationControl } from "@/components/chat/CollaborationControl";
import { ConversationModeDrawer } from "@/components/chat/ConversationModeDrawer";
import { SearchSessionContext } from "@/components/chat/SearchSessionContext";
import { AudioPlaybackProvider } from "@/components/chat/AudioPlaybackContext";
import { AutoAudioWatcher } from "@/components/chat/AutoAudioWatcher";
import { RenameChatDialog } from "@/components/chat-list/SidebarSections";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { ParticipantPicker } from "@/components/settings/ChatDefaultsSection.ParticipantPicker";
import { modelHasImageOutput } from "@/components/shared/ModelPickerShared";
import { useToast } from "@/components/shared/Toast.context";
import { analyticsErrorLabel, captureAnalytics, createAnalyticsClientMetadata } from "@/lib/analytics";
import { captureFeatureUsage } from "@/lib/featureAnalytics";
import { convexErrorMessage } from "@/lib/convexErrors";
import { mentionedParticipantKeys } from "@/hooks/useMentionAutocomplete";
import {
  useChatScroll, useMentionSuggestions, useSubagentOverride,
  useSearchMode,
} from "@/routes/ChatPage.helpers";
import { ChatHeader, EmptyChatState, ChatModalPanels } from "@/routes/ChatPage.header";
import { SlashCommandPalette, TurnOverrideChips } from "@/components/chat/SlashCommandPalette";
import { DocumentPreviewPanel, type DocumentPreviewSelection } from "@/components/chat/DocumentPreviewPanel";
import { PresentationArtifactPanel } from "@/components/chat/PresentationArtifactPanel";
import type { GeneratedFileOpenRequest } from "@/components/chat/GeneratedFilesCard";
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
  visibleMessagesForCollaboration,
  visibleMessagesForPath,
} from "@/routes/ChatPage.branchFlow";
import {
  documentAnnotationBelongsToGeneratedFile,
  liveDocumentPreviewAnnotations,
} from "@/routes/ChatPage.flow";
import { useDrivePickerContinuation } from "@/routes/ChatPage.drivePicker";
import {
  composerAttachmentState,
  executeChatSend,
  executeRecordedAudioSend,
  type ChatAttachment,
  type ChatVideoRole,
} from "@/routes/ChatPage.sendFlow";
import { buildRegeneratePaperArgs } from "@/routes/ChatPage.searchFlow";
import {
  buildRetryMessageArgs,
  retryBaseParticipantForMessage,
  retryGoogleIntegrationsAreActive,
  retryAnalyticsSnapshot,
  retryParticipantWithModel,
  retryParticipantWithPersona,
} from "@/routes/ChatPage.retryFlow";
import { useChatParticipantsConfig } from "@/routes/ChatPage.participantsConfig";
import { ChatPageView } from "@/routes/ChatPage.view";
import { useAdvisorComposer } from "@/hooks/useAdvisorComposer";
import { AdvisorComposerChips } from "@/components/chat/AdvisorComposerChips";
import { AdvisorPicker } from "@/components/chat/AdvisorPicker";
import { PaywallModal } from "@/components/shared/PaywallModal";
import type { PlusMenuItem } from "@/components/chat/ChatPlusMenu";
import type { PersonaItem } from "@/components/chat/ChatParticipantPicker.helpers";
import type { QueuedAdvisorSnapshot } from "@/advisors/types";
import { RemoteMcpPendingPanel } from "@/components/chat/RemoteMcpPendingPanel";
import {
  RemoteMcpContentPicker,
  type StagedRemoteMcpContext,
} from "@/components/chat/RemoteMcpContentPicker";
import {
  enabledRemoteMcpConnectionIds as resolveEnabledRemoteMcpConnectionIds,
  filterRemoteMcpContentForEnabledConnections,
  stagedRemoteMcpContextsForChat,
} from "@/lib/remoteMcp";

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
  const remoteMcpConnections = useQuery(api.mcp.queries.listActiveConnectionOptions, {});
  const remoteMcpContent = useQuery(api.mcp.queries.listAvailableContent, {});
  const [showRemoteMcpContent, setShowRemoteMcpContent] = useState(false);
  const [stagedRemoteMcpContexts, setStagedRemoteMcpContexts] = useState<StagedRemoteMcpContext[]>([]);
  const showAdvancedStats = typedPrefs?.showAdvancedStats === true;
  const { messageCosts, totalCost, breakdown } = useChatCosts(typedChatId, showAdvancedStats);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollContainerRef = useRef<HTMLDivElement>(null);
  const trackedOpenChatIdRef = useRef<string | null>(null);
  const {
    participants: convexParticipants,
    isLoading: isParticipantsLoading,
    addParticipant,
    removeParticipant: removeParticipantMut,
    setParticipants: setParticipantsMut,
  } = useParticipants(typedChatId);
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
  const collaboration = useCollaboration(typedChatId);
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
    settingsIntegrationDefaults: typedPrefs?.integrationDefaults,
    updateChat,
  });
  const enabledRemoteMcpConnectionIds = useMemo(
    () => resolveEnabledRemoteMcpConnectionIds(remoteMcpConnections, overrides.enabledIntegrations),
    [overrides.enabledIntegrations, remoteMcpConnections],
  );
  const enabledRemoteMcpContent = useMemo(
    () => filterRemoteMcpContentForEnabledConnections(remoteMcpContent, enabledRemoteMcpConnectionIds),
    [enabledRemoteMcpConnectionIds, remoteMcpContent],
  );
  const enabledRemoteMcpConnectionIdSet = useMemo(
    () => new Set(enabledRemoteMcpConnectionIds),
    [enabledRemoteMcpConnectionIds],
  );
  const visibleStagedRemoteMcpContexts = useMemo(
    () => stagedRemoteMcpContextsForChat(
      stagedRemoteMcpContexts,
      chatId,
      enabledRemoteMcpConnectionIdSet,
    ),
    [chatId, enabledRemoteMcpConnectionIdSet, stagedRemoteMcpContexts],
  );
  const [showSlashPalette, setShowSlashPalette] = useState(false);
  const [documentPreview, setDocumentPreview] = useState<DocumentPreviewSelection | null>(null);
  const [stagedPresentationTarget, setStagedPresentationTarget] = useState<{
    chatId: string;
    context: PresentationContext;
    label: string;
  } | null>(null);
  const activePresentationTarget = stagedPresentationTarget?.chatId === chatId
    ? stagedPresentationTarget
    : null;
  const handleComposerTextChange = useCallback((text: string) => {
    setShowSlashPalette(text === "/");
  }, []);

  useEffect(() => {
    if (!typedChatId || !chat || isLoading || isParticipantsLoading) return;
    const chatIdString = String(typedChatId);
    if (trackedOpenChatIdRef.current === chatIdString) return;
    trackedOpenChatIdRef.current = chatIdString;
    captureAnalytics("chat_opened", {
      feature_area: "chat",
      chat_id: chatIdString,
      chat_mode: chat.mode,
      message_count: messages.length,
      participant_count: convexParticipants.length,
    });
  }, [chat, convexParticipants.length, isLoading, isParticipantsLoading, messages.length, typedChatId]);
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
      const disabledConnectionId = remoteMcpConnections?.find(
        (connection) => connection.integrationId === key,
      )?.connectionId;
      if (disabledConnectionId) {
        setStagedRemoteMcpContexts((current) => current.filter(
          (context) => context.connectionId !== disabledConnectionId,
        ));
      }
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
  }, [gmailManualConnection?.status, googleConnection, overrides, remoteMcpConnections, t, toast]);
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
  const visibleMessages = useMemo(() => {
    if (collaboration.behavior !== "collaboration") {
      return visibleMessagesForPath(messages, resolvedPath);
    }
    return visibleMessagesForCollaboration(
      messages,
      resolvedPath,
      collaboration.state?.exchange?.id,
    );
  }, [collaboration.behavior, collaboration.state?.exchange?.id, messages, resolvedPath]);
  const groupedMessages = useMessageGrouping(visibleMessages);
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
  const createChatUploadUrl = useMutation(api.chat.mutations.createChatUploadUrl);
  const bindChatUploadSession = useMutation(api.chat.mutations.bindChatUploadSession);
  const cleanupChatUploadSession = useMutation(api.chat.mutations.cleanupChatUploadSession);
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
  const imageGenerationModelIds = useMemo(
    () => new Set((modelSummaries ?? []).filter(modelHasImageOutput).map((model) => model.modelId)),
    [modelSummaries],
  );
  const {
    participants,
    paramDefaults,
    allParticipantsSupportTools,
    isVideoMode,
    supportsFrameImages,
    supportsVision,
    supportsFileInput,
    supportsAudioInput,
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
  const mentionSuggestions = useMentionSuggestions(participants);

  const { subagentOverride, effectiveSubagentsEnabled, handleSubagentOverrideChange } = useSubagentOverride({
    chat, isPro,
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
  const branchSwitchRequestRef = useRef(0);
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
    const requestId = branchSwitchRequestRef.current + 1;
    branchSwitchRequestRef.current = requestId;
    setOptimisticLeafId(selection.optimisticLeafId);
    void switchBranchAtFork({
      chatId: typedChatId,
      currentSiblingMessageId: selection.currentSiblingId,
      targetSiblingMessageId: selection.targetSiblingId,
    }).then((nextLeafId) => {
      if (branchSwitchRequestRef.current !== requestId) return;
      setOptimisticLeafId(nextLeafId);
    }).catch(() => {
      if (branchSwitchRequestRef.current !== requestId) return;
      setOptimisticLeafId(undefined);
    });
  }, [navigateBranch, setOptimisticLeafId, typedChatId, switchBranchAtFork]);

  useEffect(() => {
    branchSwitchRequestRef.current += 1;
    setOptimisticLeafId(undefined);
  }, [setOptimisticLeafId, typedChatId]);

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
    captureAnalytics("chat_created", {
      feature_area: "chat",
      chat_id: String(newId),
      source: "chat_page",
      participant_count: participants.length,
      model_ids: participants.map((participant) => participant.modelId).join(","),
      has_folder: false,
    });
    navigate(`/app/chat/${newId}`, { replace: true });
    return newId;
  }, [typedChatId, createChat, navigate, participants]);

  const turnOverrideArgs = useMemo(() => ({
    ...(overrides.turnSkillOverrideEntries.length > 0 ? { turnSkillOverrides: overrides.turnSkillOverrideEntries } : {}),
    ...(overrides.turnIntegrationOverrideEntries.length > 0 ? { turnIntegrationOverrides: overrides.turnIntegrationOverrideEntries } : {}),
  }), [overrides.turnSkillOverrideEntries, overrides.turnIntegrationOverrideEntries]);
  const advisors = useAdvisorComposer({
    chatId: typedChatId,
    participants,
    turnIntegrationOverrides: overrides.turnIntegrationOverrideEntries,
    personas: personas as PersonaItem[] | undefined,
    isPro,
    effectiveWebSearch: webSearchEnabled,
    modelSummaries: modelSummaries ?? undefined,
    defaultModelId: typedPrefs?.defaultModelId,
  });
  const handlePlusMenuSelect = useCallback((item: PlusMenuItem) => {
    if (item === "advisors") {
      advisors.open();
      return;
    }
    if (item === "remoteMcpContent") {
      setShowRemoteMcpContent(true);
      return;
    }
    overrides.handlePlusMenuSelect(item);
  }, [advisors, overrides]);
  const plusMenuBadges = useMemo(() => ({
    ...overrides.badges,
    ...(advisors.state.selections.length > 0 ? { advisors: advisors.state.selections.length } : {}),
  }), [advisors.state.selections.length, overrides.badges]);
  const handleCancelSession = useCallback(
    (sessionId: string) => {
      void cancelSession({ sessionId: sessionId as Id<"searchSessions"> }).then(() => {
        const session = sessionMap.get(sessionId);
        captureAnalytics("generation_cancelled", {
          feature_area: "chat",
          chat_id: session ? String(session.chatId) : null,
          message_id: session ? String(session.assistantMessageId) : null,
          session_id: sessionId,
          search_mode: session?.mode ?? "unknown",
        });
      });
    },
    [cancelSession, sessionMap],
  );
  const handleRegeneratePaper = useCallback(
    (sessionId: string) => {
      const participant = participants[0];
      if (!participant) return;
      const analytics = createAnalyticsClientMetadata("message_retry_requested", window.location.pathname);
      const session = sessionMap.get(sessionId);
      const properties = {
        feature_area: "chat",
        chat_id: session ? String(session.chatId) : null,
        message_id: session ? String(session.assistantMessageId) : null,
        session_id: sessionId,
        search_mode: "paper",
        model_id: participant.modelId,
        integration_count: overrides.enabledIntegrations.size,
        client_event_id: analytics.clientEventId,
      };
      captureAnalytics("message_retry_requested", properties);
      void regeneratePaper(buildRegeneratePaperArgs({
        sessionId,
        participant,
        enabledIntegrations: overrides.enabledIntegrations,
        analytics,
      })).catch((error) => {
        captureAnalytics("message_retry_failed", {
          ...properties,
          error_type: error instanceof Error ? error.name : "unknown",
          error_label: analyticsErrorLabel(error),
        });
        const fallback = t("failed_to_regenerate_paper_arg", {
          var1: t("something_went_wrong"),
        });
        toast({ message: convexErrorMessage(error, fallback), variant: "error" });
      });
    },
    [overrides.enabledIntegrations, participants, regeneratePaper, sessionMap, t, toast],
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
  const liveDocumentPreview = useMemo(() => {
    if (!documentPreview) return null;
    const liveAnnotations = liveDocumentPreviewAnnotations({
      liveAnnotations: visibleMessages.flatMap((message) => message.documentEditAnnotations ?? []),
      selectedAnnotations: documentPreview.annotations ?? [],
      generatedFileId: documentPreview.generatedFileId,
      versionId: documentPreview.versionId,
      focusEditId: documentPreview.focusEditId,
      focusEditBatchId: documentPreview.focusEditBatchId,
    });
    if (liveAnnotations.length === 0) return documentPreview;
    const liveVersionId = liveAnnotations.find((annotation) => annotation.editId === documentPreview.focusEditId)?.versionId
      ?? liveAnnotations[0]?.versionId
      ?? documentPreview.versionId;
    return { ...documentPreview, versionId: liveVersionId, annotations: liveAnnotations };
  }, [documentPreview, visibleMessages]);

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
      return message;
    }
    return null;
  }, [convexComplexity, isResearchPaper, participants.length, toast]);

  const handleSend = useCallback(
    async ({ text, attachments, advisorSnapshot, presentationContext, mcpInvocationIds }: {
      text: string;
      attachments?: ChatAttachment[];
      advisorSnapshot?: QueuedAdvisorSnapshot;
      presentationContext?: PresentationContext;
      mcpInvocationIds?: string[];
    }) => {
      if (isResearchPaper && (mcpInvocationIds?.length ?? 0) > 0) {
        toast({ message: t("remote_mcp_context_normal_chat_only"), variant: "error" });
        return false;
      }
      if (advisorSnapshot === undefined && !advisors.canSendCurrentSelection) {
        toast({ message: t("advisor_loading"), variant: "error" });
        return false;
      }
      const advisorSelections = advisorSnapshot?.advisorSelections ?? advisors.advisorSelections;
      const advisorBrief = advisorSnapshot === undefined
        ? advisors.advisorBrief
        : advisorSnapshot.advisorBrief;
      const sent = await executeChatSend({
        text,
        state: {
          chatId: chatId ?? undefined,
          ...composerAttachmentState({ attachments, kbAttachmentsForDisplay }),
          participants,
          mentionedParticipantKeys: mentionedParticipantKeys(text, mentionSuggestions),
          turnOverrideArgs,
          enabledIntegrations: overrides.enabledIntegrations,
          subagentsEnabled: effectiveSubagentsEnabled,
          webSearchEnabled,
          convexSearchMode,
          convexComplexity,
          isResearchPaper,
          isVideoMode,
          prefs: typedPrefs,
          advisorSelections,
          advisorBrief,
          presentationContext,
          mcpInvocationIds,
        },
        deps: {
          validateAttachmentCount: validateSendState,
          ensureChatId,
          flushPendingState: overrides.flushPendingState,
          sendMessage,
          startResearchPaper,
          clearKBFiles: overrides.clearKBFiles,
          clearTurnOverrides: overrides.clearTurnOverrides,
        },
      });
      if (sent && advisorSnapshot === undefined && (advisorSelections?.length || advisorBrief)) {
        advisors.completeSuccessfulSend();
      }
      if (sent && presentationContext) {
        setStagedPresentationTarget((current) => current?.context === presentationContext ? null : current);
      }
      return sent;
    },
    [chatId, ensureChatId, kbAttachmentsForDisplay, sendMessage, startResearchPaper, participants, mentionSuggestions, turnOverrideArgs, effectiveSubagentsEnabled, webSearchEnabled, convexSearchMode, convexComplexity, isResearchPaper, isVideoMode, typedPrefs, overrides, validateSendState, advisors, t, toast],
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
      if (!advisors.canSendCurrentSelection) {
        toast({ message: t("advisor_loading"), variant: "error" });
        return;
      }
      try {
        const sent = await executeRecordedAudioSend({
          recording: result,
          state: {
            chatId: chatId ?? undefined,
            selectedAttachments: [],
            kbAttachmentsForDisplay,
            participants,
            turnOverrideArgs,
            enabledIntegrations: overrides.enabledIntegrations,
            subagentsEnabled: effectiveSubagentsEnabled,
            webSearchEnabled,
            convexSearchMode,
            convexComplexity,
            isResearchPaper,
            isVideoMode,
            prefs: typedPrefs,
            advisorSelections: advisors.advisorSelections,
            advisorBrief: advisors.advisorBrief,
            presentationContext: activePresentationTarget?.context,
          },
          deps: {
            validateAttachmentCount: validateSendState,
            ensureChatId,
            flushPendingState: overrides.flushPendingState,
            createUploadUrl: () => createUploadUrl({}),
            uploadRecording: (url, init) => fetch(url, init),
            sendMessage,
            startResearchPaper,
            clearKBFiles: overrides.clearKBFiles,
            clearTurnOverrides: overrides.clearTurnOverrides,
          },
        });
        if (sent && (advisors.advisorSelections?.length || advisors.advisorBrief)) {
          advisors.completeSuccessfulSend();
        }
        if (sent && activePresentationTarget) setStagedPresentationTarget(null);
      } catch (error) {
        toast({
          message: convexErrorMessage(error, t("upload_failed_arg", { var1: t("something_went_wrong") })),
          variant: "error",
        });
      }
    },
    [chatId, ensureChatId, createUploadUrl, sendMessage, startResearchPaper, participants, effectiveSubagentsEnabled, webSearchEnabled, convexSearchMode, convexComplexity, isResearchPaper, isVideoMode, typedPrefs, overrides, kbAttachmentsForDisplay, validateSendState, turnOverrideArgs, toast, t, advisors, activePresentationTarget],
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
  const handleComposerCancel = useCallback(() => {
    if (collaboration.isActive) return collaboration.stop();
    handleCancel();
  }, [collaboration, handleCancel]);
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
    const targetMessage = messages.find((message) => message._id === retryDifferentMessageId);
    const analyticsSnapshot = targetMessage?.retryContract
      ? retryAnalyticsSnapshot(targetMessage.retryContract)
      : undefined;
    void retryMessage({
      messageId: retryDifferentMessageId,
      participants: [retryParticipantWithModel(retryBaseParticipant, modelId)],
      ...(analyticsSnapshot ? { analyticsSnapshot } : {}),
    });
    setRetryDifferentMessageId(null);
  }, [messages, retryBaseParticipant, retryDifferentMessageId, retryMessage]);
  const handleSelectRetryPersona = useCallback((personaId: string) => {
    if (!retryDifferentMessageId) return;
    const targetMessage = messages.find((message) => message._id === retryDifferentMessageId);
    const analyticsSnapshot = targetMessage?.retryContract
      ? retryAnalyticsSnapshot(targetMessage.retryContract)
      : undefined;
    void retryMessage({
      messageId: retryDifferentMessageId,
      participants: [retryParticipantWithPersona({
        baseParticipant: retryBaseParticipant,
        personaId,
        personas,
      })],
      ...(analyticsSnapshot ? { analyticsSnapshot } : {}),
    });
    setRetryDifferentMessageId(null);
  }, [messages, retryBaseParticipant, retryDifferentMessageId, retryMessage, personas]);
  const handleFork = useCallback(async (messageId: Id<"messages">) => {
    if (!typedChatId) return;
    const forkedChatId = await forkChat({ chatId: typedChatId, atMessageId: messageId });
    captureAnalytics("branch_created", {
      feature_area: "chat",
      source_chat_id: String(typedChatId),
      chat_id: forkedChatId ? String(forkedChatId) : null,
      message_id: String(messageId),
    });
    captureFeatureUsage({
      feature_area: "chat",
      feature: "branching",
      action: "created",
      source_chat_id: String(typedChatId),
      chat_id: forkedChatId ? String(forkedChatId) : null,
      message_id: String(messageId),
    });
    navigate(`/app/chat/${forkedChatId}`);
  }, [typedChatId, forkChat, navigate]);
  const handleOpenGeneratedFile = useCallback((request: GeneratedFileOpenRequest & { message: Message }) => {
    const annotations = (request.message.documentEditAnnotations ?? []).filter((annotation) =>
      documentAnnotationBelongsToGeneratedFile(annotation, request.file)
    );
    setDocumentPreview({
      messageId: request.message._id,
      file: request.file,
      generatedFileId: request.file._id,
      filename: request.file.filename,
      mimeType: request.file.mimeType,
      sizeBytes: request.file.sizeBytes,
      downloadUrl: request.file.downloadUrl,
      versionId: request.file.documentVersionId,
      annotations,
    });
  }, []);
  const handleOpenDocumentEdit = useCallback((annotation: NonNullable<Message["documentEditAnnotations"]>[number], message: Message) => {
    const batchAnnotations = visibleMessages.flatMap((candidate) => candidate.documentEditAnnotations ?? []).filter((candidate) =>
      candidate.editBatchId === annotation.editBatchId
    );
    setDocumentPreview({
      messageId: message._id,
      generatedFileId: annotation.generatedFileId,
      filename: annotation.filename,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      versionId: annotation.versionId,
      annotations: batchAnnotations.length > 0 ? batchAnnotations : [annotation],
      focusEditId: annotation.editId,
      focusEditBatchId: annotation.editBatchId,
    });
  }, [visibleMessages]);
  const handleJumpToNext = useCallback((targetMessageId: Id<"messages">) => {
    const el = messagesScrollContainerRef.current?.querySelector(
      `[data-message-id="${targetMessageId}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  if (typedChatId && isLoading) {
    return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;
  }

  return (
    <ChatPageView
      header={<ChatHeader
        title={chat?.title ?? ""} onBack={() => navigate("/app")} participants={participants}
        isPro={isPro} onRename={() => setShowRename(true)} searchMode={searchMode}
        globeColor={globeColor}
        onSetSearchMode={setSearchModeOverride}
        isMultiModel={isMultiModel} onToggleIdeascape={handleToggleIdeascape}
        totalCost={totalCost} showAdvancedStats={showAdvancedStats} breakdown={breakdown}
      />}
      messageArea={<AudioPlaybackProvider defaultAudioSpeed={typedPrefs?.defaultAudioSpeed}>
        <AutoAudioWatcher messages={visibleMessages} isLoading={isLoading} />
          <SearchSessionContext.Provider value={searchSessionCtx}>
          <div ref={messagesScrollContainerRef} data-ph-block data-ph-mask className="h-full overflow-y-auto px-4 py-4 space-y-4">
            {visibleMessages.length === 0 ? <EmptyChatState /> : groupedMessages.map((group) =>
              group.type === "single" ? (
                <div key={group.message._id} data-message-id={group.message._id}>
                  {branchNodes.has(group.message._id) && <BranchIndicator node={branchNodes.get(group.message._id)!} onNavigate={handleBranchNavigate} onJumpToNext={handleJumpToNext} />}
                  <MessageBubble message={group.message} isStreaming={isGenerating && group.message.status === "streaming"} participants={participants} onRetry={handleRetry} onFork={handleFork} onRetryWithDifferentModel={handleRetryWithDifferentModel} messageCost={messageCosts[group.message._id]} showAdvancedStats={showAdvancedStats} onOpenGeneratedFile={handleOpenGeneratedFile} onOpenDocumentEdit={handleOpenDocumentEdit} />
                </div>
              ) : (
                <div key={messageGroupKey(group)} data-message-id={group.messages[0]?._id}>
                  {group.messages[0] && branchNodes.has(group.messages[0]._id) && <BranchIndicator node={branchNodes.get(group.messages[0]._id)!} onNavigate={handleBranchNavigate} onJumpToNext={handleJumpToNext} />}
                  <MultiModelResponseGroup groupId={group.groupId} messages={group.messages} isStreaming={isGenerating} participants={participants} onRetry={handleRetry} onFork={handleFork} onRetryWithDifferentModel={handleRetryWithDifferentModel} messageCosts={messageCosts} showAdvancedStats={showAdvancedStats} onOpenGeneratedFile={handleOpenGeneratedFile} onOpenDocumentEdit={handleOpenDocumentEdit} />
                </div>
              ),
            )}
            {showPendingResponsePlaceholder && visibleMessages.length > 0 && (
              <PendingResponseGroup
                participants={participants}
                imageGenerationModelIds={imageGenerationModelIds}
              />
            )}
            <div ref={messagesEndRef} />
          </div>
          </SearchSessionContext.Provider>
        </AudioPlaybackProvider>}
      sidePanel={liveDocumentPreview?.file?.presentationProjectId ? (
        <PresentationArtifactPanel
          projectId={liveDocumentPreview.file.presentationProjectId}
          filename={liveDocumentPreview.filename}
          onClose={() => setDocumentPreview(null)}
          onStageContext={(target) => {
            if (!typedChatId) return;
            setStagedPresentationTarget({ chatId: String(typedChatId), ...target });
          }}
        />
      ) : liveDocumentPreview ? (
        <DocumentPreviewPanel selection={liveDocumentPreview} onClose={() => setDocumentPreview(null)} />
      ) : null}
      autonomousToolbar={<AutonomousToolbar state={autonomous.state} onPause={autonomous.pause} onResume={autonomous.resume} onStop={autonomous.stop} onDismiss={autonomous.dismissEnded} />}
      collaborationControl={<CollaborationControl
        collaboration={collaboration}
        autonomousActive={isAutonomousActive}
      />}
      balanceIndicator={typedPrefs?.showBalanceInChat === true ? <BalanceIndicator balance={creditBalance} /> : null}
      turnOverrideChips={<>
        <TurnOverrideChips
          turnSkillOverrides={overrides.turnSkillOverrides}
          turnIntegrationOverrides={overrides.turnIntegrationOverrides}
          onRemoveSkill={overrides.removeTurnSkillOverride}
          onRemoveIntegration={overrides.removeTurnIntegrationOverride}
          skillNames={slashSkillNames}
        />
        <AdvisorComposerChips owner={advisors} />
      </>}
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
        isCollaborationActive={collaboration.isActive}
        onSend={handleSend} onCancel={handleComposerCancel}
        onCreateUploadUrl={() => createChatUploadUrl({})}
        onBindUploadSession={async (uploadSessionId, storageId) => { await bindChatUploadSession({ uploadSessionId: uploadSessionId as Id<"chatUploadSessions">, storageId: storageId as Id<"_storage"> }); }}
        onCleanupUploadSession={async (uploadSessionId, storageId) => { await cleanupChatUploadSession({ uploadSessionId: uploadSessionId as Id<"chatUploadSessions">, ...(storageId ? { storageId: storageId as Id<"_storage"> } : {}) }); }}
        onPlusMenuSelect={handlePlusMenuSelect} plusMenuBadges={plusMenuBadges} isPro={isPro}
        hasConnectedIntegrations={hasConnectedIntegrations} participantCount={participants.length}
        mentionSuggestions={mentionSuggestions} disabled={!!typedChatId && isLoading} isAutonomousActive={isAutonomousActive}
        onIntervene={autonomous.intervene} onSendRecording={handleSendRecording}
        allParticipantsSupportTools={allParticipantsSupportTools}
        isVideoMode={isVideoMode}
        supportsFrameImages={supportsFrameImages}
        supportsVision={supportsVision}
        supportsFileInput={supportsFileInput}
        supportsAudioInput={supportsAudioInput}
        onTextChange={handleComposerTextChange}
        extraAttachments={kbAttachmentsForDisplay}
        canCaptureQueuedAdvisorSnapshot={advisors.canCaptureQueuedSnapshot}
        captureQueuedAdvisorSnapshot={advisors.captureQueuedSnapshot}
        restoreQueuedAdvisorSnapshot={advisors.restoreQueuedSnapshot}
        generatedDocumentSuggestion={generatedDocumentSuggestion}
        presentationTarget={activePresentationTarget ?? undefined}
        onRemovePresentationTarget={() => setStagedPresentationTarget(null)}
        remoteMcpContexts={visibleStagedRemoteMcpContexts}
        onRemoveRemoteMcpContext={(invocationId) => setStagedRemoteMcpContexts((current) =>
          current.filter((context) => context.invocationId !== invocationId),
        )}
        onClearRemoteMcpContexts={() => setStagedRemoteMcpContexts([])}
        hasRemoteMcpContent={(enabledRemoteMcpContent?.length ?? 0) > 0}
        onRemoveExtra={(i) => {
          const sid = kbAttachmentsForDisplay[i]?.storageId;
          if (sid) overrides.toggleKBFile(sid);
        }}
        onChangeExtraRole={(i, role) => {
          const sid = kbAttachmentsForDisplay[i]?.storageId;
          if (sid) setKbVideoRoles((prev) => ({ ...prev, [sid]: role }));
        }}
      />}
      modalPanels={<>
        {overrides.activePanel === "conversationMode" && (
          <ConversationModeDrawer
            behavior={collaboration.behavior}
            autonomousActive={isAutonomousActive}
            hasMessages={hasMessages}
            isPro={isPro}
            isUpdating={collaboration.isUpdating}
            error={collaboration.error}
            onSelectBehavior={collaboration.setBehavior}
            onConfigureAutonomous={() => overrides.setActivePanel("autonomous")}
            onClose={overrides.closePanel}
          />
        )}
        <ChatModalPanels
          activePanel={overrides.activePanel} closePanel={overrides.closePanel}
          paramOverrides={overrides.paramOverrides} setParamOverrides={overrides.setParamOverrides} paramDefaults={paramDefaults}
          enabledIntegrations={overrides.enabledIntegrations} toggleIntegration={(key) => { void handleIntegrationToggle(key); }} connectedProviders={connectedProviders} googleIntegrationsBlocked={googleIntegrationsBlocked}
          remoteMcpConnections={remoteMcpConnections ?? []}
          enabledSkillIds={overrides.enabledSkillIds} toggleSkill={overrides.toggleSkill}
          skillOverrides={overrides.skillOverrides}
          cycleSkill={overrides.cycleSkill}
          selectedKBFileIds={overrides.selectedKBFileIds} toggleKBFile={overrides.toggleKBFile}
          chatId={typedChatId} convexParticipants={convexParticipants}
          addParticipant={addParticipant} removeParticipant={removeParticipantMut} setParticipants={setParticipantsMut}
          subagentOverride={subagentOverride} effectiveSubagentsEnabled={effectiveSubagentsEnabled}
          isPro={isPro} handleSubagentOverrideChange={handleSubagentOverrideChange}
          autonomousSettings={autonomous.settings} onAutonomousSettingsChange={autonomous.setSettings}
          participants={participants} hasMessages={hasMessages} onAutonomousStart={autonomous.start}
        />
        {advisors.state.surface === "picker" && (
          <AdvisorPicker owner={advisors} personas={(personas as PersonaItem[] | undefined) ?? []} />
        )}
        {advisors.state.surface === "paywall" && (
          <PaywallModal feature={t("advisors")} onClose={advisors.close} />
        )}
        {showRemoteMcpContent && typedChatId && (
          <RemoteMcpContentPicker
            chatId={typedChatId}
            enabledConnectionIds={enabledRemoteMcpConnectionIds}
            onClose={() => setShowRemoteMcpContent(false)}
            onAttach={(context) => setStagedRemoteMcpContexts((current) => [
              ...current.filter((entry) => entry.invocationId !== context.invocationId),
              context,
            ])}
          />
        )}
        {typedChatId && <RemoteMcpPendingPanel chatId={typedChatId} />}
      </>}
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
