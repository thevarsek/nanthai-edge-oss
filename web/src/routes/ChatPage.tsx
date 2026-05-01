// routes/ChatPage.tsx — Full chat view: message list, input, streaming, branching.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useChat, type Participant } from "@/hooks/useChat";
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
import { Defaults } from "@/lib/constants";
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
import { pickGoogleDriveFiles } from "@/lib/googleDrivePicker";
import { attachmentTypeForMime } from "@/components/chat/MessageInput.attachments.utils";
import {
  DEFAULT_PARAMETER_OVERRIDES,
  buildBaseParticipants,
  findDefaultPersona,
  resolveParticipants,
  validateSendState as validateChatSendState,
  type SharedPreferences,
} from "@/lib/chatRequestResolution";
import type { IntegrationKey } from "@/routes/PersonaEditorForm";

const GOOGLE_INTEGRATION_IDS = new Set(["drive", "calendar"]);

function parseDrivePickerRequest(message: ReturnType<typeof useChat>["messages"][number] | undefined): { key: string; batchId: Id<"drivePickerBatches"> } | null {
  if (!message || message.role !== "assistant" || !message.drivePickerBatchId) return null;
  if (message.status === "failed" || message.status === "cancelled") return null;
  return { key: `${message._id}:${message.drivePickerBatchId}`, batchId: message.drivePickerBatchId };
}

function latestDrivePickerRequest(messages: ReturnType<typeof useChat>["messages"]): { key: string; batchId: Id<"drivePickerBatches"> } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const request = parseDrivePickerRequest(messages[index]);
    if (request) return request;
  }
  return null;
}

function getRetryBaseParticipant(message: (ReturnType<typeof useChat>["messages"][number]) | undefined) {
  return message?.retryContract?.participants[0] ?? {
    modelId: message?.modelId ?? Defaults.model,
    personaId: message?.participantId ?? null,
    personaEmoji: null,
    personaName: message?.participantName ?? null,
    personaAvatarImageUrl: message?.participantAvatarImageUrl ?? null,
    systemPrompt: null,
    temperature: undefined,
    maxTokens: undefined,
    includeReasoning: undefined,
    reasoningEffort: null,
  };
}

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
  const defaultModelId = typedPrefs?.defaultModelId ?? Defaults.model;
  const showAdvancedStats = typedPrefs?.showAdvancedStats === true;
  const { messageCosts, totalCost, breakdown } = useChatCosts(typedChatId, showAdvancedStats);

  // Resolve default persona (matches iOS resolveDefaultParticipantConfig)
  const defaultPersona = useMemo(
    () => findDefaultPersona(personas, typedPrefs),
    [personas, typedPrefs],
  );

  const effectiveDefaultModelId = defaultPersona?.modelId ?? defaultModelId;
  const [selectedModelId, setSelectedModelId] = useState(effectiveDefaultModelId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { participants: convexParticipants, addParticipant, removeParticipant: removeParticipantMut, setParticipants: setParticipantsMut } = useParticipants(typedChatId);
  // Sync selectedModelId when convex participants load (existing chat)
  useEffect(() => {
    if (convexParticipants.length === 0) return;
    const timer = window.setTimeout(() => setSelectedModelId(convexParticipants[0].modelId), 0);
    return () => window.clearTimeout(timer);
  }, [convexParticipants]);
  // Sync selectedModelId when prefs/persona loads asynchronously (new chat)
  const resolvedDefaultRef = useRef(effectiveDefaultModelId);
  useEffect(() => {
    if (effectiveDefaultModelId !== resolvedDefaultRef.current && convexParticipants.length === 0) {
      const timer = window.setTimeout(() => {
        setSelectedModelId(effectiveDefaultModelId);
        resolvedDefaultRef.current = effectiveDefaultModelId;
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [effectiveDefaultModelId, convexParticipants.length]);
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
  const resolvedPath = (activePath.length > 0 || !messages.length) ? activePath : messages.map((m) => m._id);
  const visibleMessages = resolvedPath.map((id) => messages.find((m) => m._id === id)).filter(Boolean) as typeof messages;
  const groupedMessages = useMessageGrouping(visibleMessages);
  const chatSearch = useChatSearchWiring(visibleMessages, chatId);
  const hasVisiblePendingAssistant = visibleMessages.some(
    (message) => message.role === "assistant" && (message.status === "pending" || message.status === "streaming"),
  );
  const showPendingResponsePlaceholder = isGenerating && !hasVisiblePendingAssistant;

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
  ) as Array<{ storageId: string; filename: string; mimeType: string; sizeBytes?: number; driveFileId?: string; lastRefreshedAt?: number }> | undefined;
  useChatScroll(messagesEndRef, visibleMessages.length, isGenerating, chatId);
  const { sessionMap } = useSearchSessions(typedChatId);
  const cancelSession = useMutation(api.search.mutations.cancelResearchPaper);
  const regeneratePaper = useMutation(api.search.mutations.regeneratePaper);

  // Destructure only the override fields that actually affect participants,
  // so the participants array doesn't get a new reference when unrelated
  // override state changes (e.g. opening/closing panels).
  const { temperatureMode, temperature: overrideTemp, maxTokensMode, maxTokens: overrideMaxTokens, reasoningMode, reasoningEffort: overrideReasoningEffort } = overrides.paramOverrides;
  const baseParticipants = useMemo(() => buildBaseParticipants({
    convexParticipants,
    defaultPersona,
    selectedModelId,
  }), [convexParticipants, defaultPersona, selectedModelId]);
  const participants: Participant[] = useMemo(() => {
    return resolveParticipants({
      baseParticipants,
      personas,
      prefs: typedPrefs,
      modelSettings: modelSettings ?? undefined,
      overrides: {
        temperatureMode,
        temperature: overrideTemp,
        maxTokensMode,
        maxTokens: overrideMaxTokens,
        reasoningMode,
        reasoningEffort: overrideReasoningEffort,
      },
    });
  }, [baseParticipants, personas, typedPrefs, modelSettings, temperatureMode, overrideTemp, maxTokensMode, overrideMaxTokens, reasoningMode, overrideReasoningEffort]);

  const modelSummaries = useModelSummaries();
  const allParticipantsSupportTools = useMemo(() => {
    if (!modelSummaries) return true; // loading — assume true
    return participants.every((p) => {
      const summary = modelSummaries.find((m) => m.modelId === p.modelId);
      return summary?.supportsTools ?? true; // unknown model — assume true
    });
  }, [participants, modelSummaries]);

  const isVideoMode = useMemo(() => {
    if (!modelSummaries) return false;
    return participants.some((p) => {
      const summary = modelSummaries.find((m) => m.modelId === p.modelId);
      return summary?.supportsVideo === true;
    });
  }, [participants, modelSummaries]);

  /** Whether any video participant supports frame images (image-to-video). */
  const supportsFrameImages = useMemo(() => {
    if (!modelSummaries || !isVideoMode) return false;
    return participants.some((p) => {
      const summary = modelSummaries.find((m) => m.modelId === p.modelId);
      return summary?.supportsVideo === true && (summary.supportedFrameImages?.length ?? 0) > 0;
    });
  }, [participants, modelSummaries, isVideoMode]);

  const GOOGLE_ALLOWED_PROVIDERS = useMemo(() => new Set(["openai", "anthropic", "google"]), []);
  /** True when any chat participant uses a model incompatible with Google integrations. */
  const googleIntegrationsBlocked = useMemo(() => {
    if (!modelSummaries) return false;
    return participants.some((p) => {
      const summary = modelSummaries.find((m) => m.modelId === p.modelId);
      if (!summary) return false; // unknown model — don't block
      return !summary.hasZdrEndpoint || !GOOGLE_ALLOWED_PROVIDERS.has((summary.provider ?? "").toLowerCase());
    });
  }, [participants, modelSummaries, GOOGLE_ALLOWED_PROVIDERS]);

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
  const isMultiModel = participants.length > 1;

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
      void regeneratePaper({
        sessionId: sessionId as Id<"searchSessions">,
        modelId: participant.modelId,
        ...(participant.personaId ? { personaId: participant.personaId } : {}),
        ...(participant.personaName ? { personaName: participant.personaName } : {}),
        ...(participant.personaEmoji ? { personaEmoji: participant.personaEmoji } : {}),
        ...(participant.personaAvatarImageUrl ? { personaAvatarImageUrl: participant.personaAvatarImageUrl } : {}),
        ...(participant.temperature != null ? { temperature: participant.temperature } : {}),
        ...(participant.maxTokens != null ? { maxTokens: participant.maxTokens } : {}),
        ...(participant.includeReasoning != null ? { includeReasoning: participant.includeReasoning } : {}),
        ...(participant.reasoningEffort ? { reasoningEffort: participant.reasoningEffort } : {}),
        subagentsEnabled: effectiveSubagentsEnabled,
      });
    },
    [effectiveSubagentsEnabled, participants, regeneratePaper],
  );
  const searchSessionCtx = useMemo(
    () => ({ sessionMap, onCancel: handleCancelSession, onRegenerate: handleRegeneratePaper }),
    [handleCancelSession, handleRegeneratePaper, sessionMap],
  );
  type ChatAttachment = {
    storageId?: Id<"_storage">;
    url?: string;
    name: string;
    type: string;
    mimeType: string;
    sizeBytes?: number;
    driveFileId?: string;
    lastRefreshedAt?: number;
    videoRole?: "first_frame" | "last_frame" | "reference";
  };
  const kbAttachments = useMemo(
    (): ChatAttachment[] => (selectedKBFiles ?? []).map((file) => ({
      type: file.mimeType ? attachmentTypeForMime(file.mimeType) : "file",
      storageId: file.storageId as Id<"_storage">,
      name: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      driveFileId: file.driveFileId,
      lastRefreshedAt: file.lastRefreshedAt,
    })),
    [selectedKBFiles],
  );

  // Per-KB-file video role overrides, keyed by storageId. Local state because
  // KB query results don't track per-turn video roles.
  const [kbVideoRoles, setKbVideoRoles] = useState<Record<string, "first_frame" | "last_frame" | "reference">>({});

  // Clear role state for files that are no longer selected.
  useEffect(() => {
    setKbVideoRoles((prev) => {
      const kept = Object.fromEntries(
        Object.entries(prev).filter(([sid]) => kbAttachments.some((a) => a.storageId === sid)),
      );
      return Object.keys(kept).length === Object.keys(prev).length ? prev : kept;
    });
  }, [kbAttachments]);

  /** KB attachments enriched with default video roles when in video mode. */
  const kbAttachmentsForDisplay = useMemo((): ChatAttachment[] => {
    if (!isVideoMode || !supportsFrameImages) {
      return kbAttachments.map((a) => ({ ...a, videoRole: kbVideoRoles[a.storageId ?? ""] ?? a.videoRole }));
    }
    // Assign defaults: 1st image -> first_frame, 2nd -> last_frame, 3rd+ -> reference
    let imageIdx = 0;
    return kbAttachments.map((a) => {
      if (a.type !== "image") return a;
      const sid = a.storageId ?? "";
      const override = kbVideoRoles[sid];
      const fallback: "first_frame" | "last_frame" | "reference" =
        imageIdx === 0 ? "first_frame" : imageIdx === 1 ? "last_frame" : "reference";
      imageIdx++;
      return { ...a, videoRole: override ?? fallback };
    });
  }, [kbAttachments, isVideoMode, supportsFrameImages, kbVideoRoles]);

  const generatedDocumentSuggestion = useMemo((): ChatAttachment | undefined => {
    for (const message of [...visibleMessages].reverse()) {
      if (message.role !== "assistant") continue;
      const event = [...(message.documentEvents ?? [])].reverse().find((candidate) =>
        !!candidate.storageId && !!candidate.filename && !!candidate.mimeType
      );
      if (!event) continue;
      return {
        storageId: event.storageId,
        name: event.filename,
        type: attachmentTypeForMime(event.mimeType),
        mimeType: event.mimeType,
      };
    }
    return undefined;
  }, [visibleMessages]);

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
        // Research Paper uses a separate mutation with single participant
        await startResearchPaper({
          chatId: cid, text,
          participant: participants[0],
          complexity: convexComplexity ?? 1,
          attachments: mergedAttachments.map((a) => ({ type: a.type, storageId: a.storageId, url: a.url, name: a.name, mimeType: a.mimeType, sizeBytes: a.sizeBytes, driveFileId: a.driveFileId, lastRefreshedAt: a.lastRefreshedAt })),
          subagentsEnabled: effectiveSubagentsEnabled,
        });
      } else {
        await sendMessage({
          chatId: cid, text, participants,
          attachments: mergedAttachments.map((a) => ({ type: a.type, storageId: a.storageId, url: a.url, name: a.name, mimeType: a.mimeType, sizeBytes: a.sizeBytes, driveFileId: a.driveFileId, lastRefreshedAt: a.lastRefreshedAt, videoRole: a.videoRole })),
          ...turnOverrideArgs, subagentsEnabled: effectiveSubagentsEnabled, webSearchEnabled,
          ...(convexSearchMode ? { searchMode: convexSearchMode } : {}),
          ...(convexComplexity ? { complexity: convexComplexity } : {}),
          ...(isVideoMode ? { videoConfig: {
            aspectRatio: typedPrefs?.defaultVideoAspectRatio ?? "16:9",
            duration: typedPrefs?.defaultVideoDuration ?? 5,
            resolution: typedPrefs?.defaultVideoResolution ?? "720p",
            generateAudio: typedPrefs?.defaultVideoGenerateAudio ?? true,
          } } : {}),
        });
      }
      overrides.clearKBFiles();
      overrides.clearTurnOverrides();
    },
    [ensureChatId, kbAttachmentsForDisplay, sendMessage, startResearchPaper, participants, turnOverrideArgs, effectiveSubagentsEnabled, webSearchEnabled, convexSearchMode, convexComplexity, isResearchPaper, isVideoMode, typedPrefs, overrides, validateSendState],
  );

  const drivePickerRequest = useMemo(
    () => latestDrivePickerRequest(visibleMessages),
    [visibleMessages],
  );
  const handledDrivePickerRequestRef = useRef<string | null>(null);
  const [isDrivePickerOpening, setIsDrivePickerOpening] = useState(false);

  const openDrivePickerForContinuation = useCallback(async (): Promise<boolean> => {
    if (!drivePickerRequest || isDrivePickerOpening) return true;
    if (googleConnection?.hasDrive !== true) {
      toast({ message: t("connect_google_drive_before_choosing_files"), variant: "error" });
      return false;
    }

    const developerKey = import.meta.env.VITE_GOOGLE_PICKER_API_KEY ?? import.meta.env.VITE_GOOGLE_API_KEY;
    const appId = import.meta.env.VITE_GOOGLE_PICKER_APP_ID ?? import.meta.env.VITE_GOOGLE_PROJECT_NUMBER;
    if (!developerKey || !appId) {
      toast({ message: t("google_drive_picker_not_configured"), variant: "error" });
      return false;
    }

    setIsDrivePickerOpening(true);
    try {
      const token = await getDrivePickerAccessToken({});
      const picked = await pickGoogleDriveFiles({
        accessToken: token.accessToken,
        appId,
        developerKey,
        multiselect: true,
      });
      await attachPickedDriveFiles({
        batchId: drivePickerRequest.batchId,
        fileIds: picked.map((file) => file.id),
      });
      return true;
    } catch (error) {
      toast({ message: convexErrorMessage(error, t("google_drive_picker_failed")), variant: "error" });
      return false;
    } finally {
      setIsDrivePickerOpening(false);
    }
  }, [
    attachPickedDriveFiles,
    drivePickerRequest,
    getDrivePickerAccessToken,
    googleConnection?.hasDrive,
    isDrivePickerOpening,
    t,
    toast,
  ]);

  useEffect(() => {
    if (!drivePickerRequest) return;
    if (handledDrivePickerRequestRef.current === drivePickerRequest.key) return;
    handledDrivePickerRequestRef.current = drivePickerRequest.key;
    void openDrivePickerForContinuation().then((handled) => {
      if (!handled) handledDrivePickerRequestRef.current = null;
    });
  }, [drivePickerRequest, openDrivePickerForContinuation]);

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
        await startResearchPaper({
          chatId: cid, text: result.transcript || "(voice message)",
          participant: participants[0],
          complexity: convexComplexity ?? 1,
          attachments: mergedAttachments.map((a) => ({ type: a.type, storageId: a.storageId, url: a.url, name: a.name, mimeType: a.mimeType, sizeBytes: a.sizeBytes })),
          recordedAudio: { storageId: storageId as Id<"_storage">, transcript: result.transcript, durationMs: result.durationMs, mimeType: result.mimeType },
          subagentsEnabled: effectiveSubagentsEnabled,
        });
      } else {
        await sendMessage({
          chatId: cid, text: result.transcript || "(voice message)", participants,
          attachments: mergedAttachments.map((a) => ({ type: a.type, storageId: a.storageId, url: a.url, name: a.name, mimeType: a.mimeType, sizeBytes: a.sizeBytes, videoRole: a.videoRole })),
          recordedAudio: { storageId: storageId as Id<"_storage">, transcript: result.transcript, durationMs: result.durationMs, mimeType: result.mimeType },
          ...turnOverrideArgs, subagentsEnabled: effectiveSubagentsEnabled, webSearchEnabled,
          ...(convexSearchMode ? { searchMode: convexSearchMode } : {}),
          ...(convexComplexity ? { complexity: convexComplexity } : {}),
          ...(isVideoMode ? { videoConfig: {
            aspectRatio: typedPrefs?.defaultVideoAspectRatio ?? "16:9",
            duration: typedPrefs?.defaultVideoDuration ?? 5,
            resolution: typedPrefs?.defaultVideoResolution ?? "720p",
            generateAudio: typedPrefs?.defaultVideoGenerateAudio ?? true,
          } } : {}),
        });
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
    () => getRetryBaseParticipant(retryTargetMessage),
    [retryTargetMessage],
  );
  const retryGoogleIntegrationsActive = useMemo(() => {
    const enabledIntegrations =
      retryTargetMessage?.retryContract?.enabledIntegrations
      ?? retryTargetMessage?.enabledIntegrations
      ?? [];
    return enabledIntegrations.some((integrationId) => GOOGLE_INTEGRATION_IDS.has(integrationId));
  }, [retryTargetMessage]);

  const handleCancel = useCallback(() => { if (typedChatId) void cancelGeneration({ chatId: typedChatId }); }, [typedChatId, cancelGeneration]);
  const handleRetry = useCallback((messageId: Id<"messages">) => {
    const targetMessage = messages.find((message) => message._id === messageId);
    if (!targetMessage?.retryContract) {
      void retryMessage({
        messageId,
        ...(convexSearchMode ? { searchMode: convexSearchMode } : {}),
        ...(convexComplexity ? { complexity: convexComplexity } : {}),
        ...(Array.from(overrides.enabledIntegrations).length > 0
          ? { enabledIntegrations: Array.from(overrides.enabledIntegrations) }
          : {}),
        ...(overrides.turnSkillOverrideEntries.length > 0
          ? { turnSkillOverrides: overrides.turnSkillOverrideEntries }
          : {}),
        ...(overrides.turnIntegrationOverrideEntries.length > 0
          ? { turnIntegrationOverrides: overrides.turnIntegrationOverrideEntries }
          : {}),
        ...(effectiveSubagentsEnabled !== undefined
          ? { subagentsEnabled: effectiveSubagentsEnabled }
          : {}),
      });
      return;
    }

    void retryMessage({ messageId });
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
      participants: [{
        ...retryBaseParticipant,
        modelId,
        personaId: null,
        personaName: null,
        personaEmoji: null,
        personaAvatarImageUrl: null,
      }],
    });
    setRetryDifferentMessageId(null);
  }, [retryBaseParticipant, retryDifferentMessageId, retryMessage]);
  const handleSelectRetryPersona = useCallback((personaId: string) => {
    if (!retryDifferentMessageId) return;
    const persona = personas?.find((entry) => entry._id === personaId);
    void retryMessage({
      messageId: retryDifferentMessageId,
      participants: [{
        ...retryBaseParticipant,
        modelId: persona?.modelId ?? retryBaseParticipant.modelId,
        personaId: personaId as Id<"personas">,
        personaName: persona?.displayName ?? null,
        personaEmoji: persona?.avatarEmoji ?? null,
        personaAvatarImageUrl: persona?.avatarImageUrl ?? null,
      }],
    });
    setRetryDifferentMessageId(null);
  }, [retryBaseParticipant, retryDifferentMessageId, retryMessage, personas]);
  const handleFork = useCallback(async (messageId: Id<"messages">) => {
    if (!typedChatId) return;
    navigate(`/app/chat/${await forkChat({ chatId: typedChatId, atMessageId: messageId })}`);
  }, [typedChatId, forkChat, navigate]);
  const handleJumpToNext = useCallback((targetMessageId: Id<"messages">) => {
    const el = chatSearch.scrollContainerRef.current?.querySelector(
      `[data-message-id="${targetMessageId}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [chatSearch.scrollContainerRef]);

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
  const mentionSuggestions = useMentionSuggestions(participants);

  if (typedChatId && isLoading && !hasShownChatSkeleton) {
    return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;
  }

  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      <ChatHeader
        title={chat?.title ?? ""} onBack={() => navigate("/app")} participants={participants}
        isPro={isPro} onRename={() => setShowRename(true)} searchMode={searchMode}
        globeColor={globeColor}
        onSetSearchMode={(s) => void setSearchModeOverride(s)}
        isMultiModel={isMultiModel} onToggleIdeascape={handleToggleIdeascape}
        totalCost={totalCost} showAdvancedStats={showAdvancedStats} breakdown={breakdown}
      />
      <div className="flex-1 relative min-h-0">
        <AudioPlaybackProvider defaultAudioSpeed={typedPrefs?.defaultAudioSpeed}>
        <AutoAudioWatcher messages={visibleMessages} />
          <ChatSearchContext.Provider value={chatSearch.searchCtx}>
          <SearchSessionContext.Provider value={searchSessionCtx}>
          {chatSearch.isOpen && (
            <ChatSearchBar
              query={chatSearch.query}
              onQueryChange={chatSearch.setQuery}
              matchCount={chatSearch.matches.length}
              currentIndex={chatSearch.currentIndex}
              onNext={chatSearch.next}
              onPrev={chatSearch.prev}
              onClose={chatSearch.close}
            />
          )}
          <div ref={chatSearch.scrollContainerRef} className="h-full overflow-y-auto px-4 py-4 space-y-4">
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
        </AudioPlaybackProvider>
      </div>
      <AutonomousToolbar state={autonomous.state} onPause={autonomous.pause} onResume={autonomous.resume} onStop={autonomous.stop} onDismiss={autonomous.dismissEnded} />
      {typedPrefs?.showBalanceInChat === true && <BalanceIndicator balance={creditBalance} />}
      <TurnOverrideChips
        turnSkillOverrides={overrides.turnSkillOverrides}
        turnIntegrationOverrides={overrides.turnIntegrationOverrides}
        onRemoveSkill={overrides.removeTurnSkillOverride}
        onRemoveIntegration={overrides.removeTurnIntegrationOverride}
        skillNames={slashSkillNames}
      />
      <div className="relative">
        {showSlashPalette && (
          <SlashCommandPalette
            onSelectSkill={handleSlashSelectSkill}
            onSelectIntegration={handleSlashSelectIntegration}
            onDismiss={() => setShowSlashPalette(false)}
            turnSkillOverrides={overrides.turnSkillOverrides}
            turnIntegrationOverrides={overrides.turnIntegrationOverrides}
            connectedProviders={connectedProviders}
          />
        )}
        <MessageInput
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
      />
      </div>
      <ChatModalPanels
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
      />
      <RenameChatDialog isOpen={showRename} currentTitle={chat?.title ?? ""} onClose={() => setShowRename(false)} onRename={handleRename} />
      {retryDifferentMessageId && (
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
      )}
    </div>
  );
}
