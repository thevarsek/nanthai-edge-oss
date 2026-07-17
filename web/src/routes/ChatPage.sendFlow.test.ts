import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Participant } from "@/hooks/useChat";
import {
  buildResearchPaperArgs,
  buildSendMessageArgs,
  buildVideoConfig,
  composerAttachmentState,
  dedupeChatAttachments,
  executeChatSend,
  executeRecordedAudioSend,
  serializeChatAttachments,
  type ChatAttachment,
  type ChatSendOrchestrationDeps,
  type ChatSendOrchestrationState,
  type RecordedAudioOrchestrationDeps,
} from "./ChatPage.sendFlow";

const analyticsMocks = vi.hoisted(() => ({
  analyticsErrorLabel: vi.fn((error: unknown) => error instanceof Error ? error.name.toLowerCase() : "unknown_error"),
  captureAnalytics: vi.fn(),
  createAnalyticsClientMetadata: vi.fn((event: string, routeOrScreen?: string) => ({
    platform: "web",
    surface: "web_app",
    clientEventId: `${event}-test-event`,
    clientSentAt: 123,
    ...(routeOrScreen ? { routeOrScreen } : {}),
  })),
}));

const featureAnalyticsMocks = vi.hoisted(() => ({
  captureSendFeatureUsage: vi.fn(),
}));

vi.mock("@/lib/analytics", () => analyticsMocks);
vi.mock("@/lib/featureAnalytics", () => featureAnalyticsMocks);

const chatId = "chat_1" as Id<"chats">;
const storageId = "storage_1" as Id<"_storage">;
const participant: Participant = {
  id: "participant_1",
  modelId: "openai/gpt-5.2",
  personaId: null,
};
const advisorSelection = {
  personaId: "persona_advisor" as Id<"personas">,
  keepAvailable: false,
  allowWebSearch: true,
};

const imageAttachment: ChatAttachment = {
  type: "image",
  storageId,
  name: "frame.png",
  mimeType: "image/png",
  sizeBytes: 42,
  driveFileId: "drive_1",
  lastRefreshedAt: 123,
  videoRole: "first_frame",
};

const audioAttachment: ChatAttachment = {
  type: "audio",
  storageId: "storage_audio" as Id<"_storage">,
  name: "voice.m4a",
  mimeType: "audio/mp4",
  sizeBytes: 123,
};

function baseState(overrides: Partial<ChatSendOrchestrationState> = {}): ChatSendOrchestrationState {
  return {
    selectedAttachments: [],
    kbAttachmentsForDisplay: [],
    participants: [participant],
    turnOverrideArgs: {},
    enabledIntegrations: new Set(),
    subagentsEnabled: false,
    webSearchEnabled: false,
    isResearchPaper: false,
    isVideoMode: false,
    prefs: undefined,
    ...overrides,
  };
}

function baseDeps(overrides: Partial<ChatSendOrchestrationDeps> = {}): ChatSendOrchestrationDeps {
  return {
    validateAttachmentCount: vi.fn(() => null),
    ensureChatId: vi.fn(async () => chatId),
    flushPendingState: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => ({ userMessageId: "msg_user", assistantMessageIds: [] })),
    startResearchPaper: vi.fn(async () => ({
      sessionId: "session_1",
      userMessageId: "msg_user",
      assistantMessageId: "msg_assistant",
    })),
    clearKBFiles: vi.fn(),
    clearTurnOverrides: vi.fn(),
    ...overrides,
  };
}

function baseRecordingDeps(overrides: Partial<RecordedAudioOrchestrationDeps> = {}): RecordedAudioOrchestrationDeps {
  return {
    ...baseDeps(),
    createUploadUrl: vi.fn(async () => "https://uploads.example/voice"),
    uploadRecording: vi.fn(async () => new Response(JSON.stringify({ storageId: "storage_voice" }), { status: 200 })),
    ...overrides,
  };
}

describe("ChatPage send flow helpers", () => {
  beforeEach(() => {
    analyticsMocks.analyticsErrorLabel.mockClear();
    analyticsMocks.captureAnalytics.mockClear();
    analyticsMocks.createAnalyticsClientMetadata.mockClear();
    featureAnalyticsMocks.captureSendFeatureUsage.mockClear();
  });

  it("serializes normal attachments with video roles and Drive metadata", () => {
    expect(serializeChatAttachments([imageAttachment], { includeVideoRole: true })).toEqual([{
      type: "image",
      storageId,
      url: undefined,
      name: "frame.png",
      mimeType: "image/png",
      sizeBytes: 42,
      driveFileId: "drive_1",
      lastRefreshedAt: 123,
      videoRole: "first_frame",
    }]);
  });

  it("omits video roles for research paper attachment payloads", () => {
    expect(serializeChatAttachments([imageAttachment], { includeVideoRole: false })?.[0]).not.toHaveProperty("videoRole");
  });

  it("deduplicates attachments that enter through both composer and extra context", () => {
    const duplicateKbAttachment = {
      ...imageAttachment,
      name: "same-storage-different-label.png",
    };
    const localAttachment: ChatAttachment = {
      type: "document",
      storageId: "storage_local" as Id<"_storage">,
      name: "local.pdf",
      mimeType: "application/pdf",
    };

    expect(dedupeChatAttachments([
      imageAttachment,
      duplicateKbAttachment,
      localAttachment,
    ])).toEqual([imageAttachment, localAttachment]);
  });

  it("treats explicit composer attachments as the complete turn payload", () => {
    const laterKbAttachment: ChatAttachment = {
      type: "document",
      storageId: "storage_later" as Id<"_storage">,
      name: "later.pdf",
      mimeType: "application/pdf",
    };

    expect(composerAttachmentState({
      attachments: [imageAttachment],
      kbAttachmentsForDisplay: [laterKbAttachment],
    })).toEqual({
      selectedAttachments: [imageAttachment],
      kbAttachmentsForDisplay: [],
    });
  });

  it("keeps current KB attachments when no explicit composer payload was provided", () => {
    expect(composerAttachmentState({
      kbAttachmentsForDisplay: [imageAttachment],
    })).toEqual({
      selectedAttachments: [],
      kbAttachmentsForDisplay: [imageAttachment],
    });
  });

  it("builds video config from preferences with defaults", () => {
    expect(buildVideoConfig(true, {
      defaultVideoAspectRatio: "9:16",
      defaultVideoDuration: 8,
      defaultVideoResolution: "1080p",
      defaultVideoGenerateAudio: false,
    })).toEqual({
      aspectRatio: "9:16",
      duration: 8,
      resolution: "1080p",
      generateAudio: false,
    });
    expect(buildVideoConfig(false, undefined)).toBeUndefined();
  });

  it("builds sendMessage args without changing the Convex wire shape", () => {
    const presentationContext = {
      projectId: "presentation_1",
      projectRevision: 5,
      slideId: "slide-2",
      slideRevision: 3,
      elementId: "headline",
    };
    const args = buildSendMessageArgs({
      chatId,
      text: "hello",
      participants: [participant],
      attachments: [imageAttachment],
      recordedAudio: {
        storageId,
        transcript: "voice",
        durationMs: 100,
        mimeType: "audio/webm",
      },
      turnOverrideArgs: {
        turnSkillOverrides: [{ skillId: "skill_1" as Id<"skills">, state: "always" }],
      },
      enabledIntegrations: new Set(["gmail", "drive"]),
      advisorSelections: [advisorSelection],
      advisorBrief: "Review the evidence",
      subagentsEnabled: true,
      webSearchEnabled: true,
      convexSearchMode: "web",
      convexComplexity: 2,
      isVideoMode: true,
      prefs: undefined,
      presentationContext,
    });

    expect(args).toMatchObject({
      chatId,
      text: "hello",
      participants: [participant],
      enabledIntegrations: ["gmail", "drive"],
      advisorSelections: [advisorSelection],
      advisorBrief: "Review the evidence",
      webSearchEnabled: true,
      searchMode: "web",
      complexity: 2,
      subagentsEnabled: true,
      videoConfig: {
        aspectRatio: "16:9",
        duration: 5,
        resolution: "720p",
        generateAudio: true,
      },
      presentationContext,
    });
    expect(args.attachments?.[0]).toMatchObject({ videoRole: "first_frame" });
    expect(args.recordedAudio).toMatchObject({ transcript: "voice" });
    expect(args.turnSkillOverrides).toEqual([{ skillId: "skill_1", state: "always" }]);
  });

  it("does not carry stale optional send state when the current turn has no active overrides", () => {
    const args = buildSendMessageArgs({
      chatId,
      text: "clean turn",
      participants: [participant],
      attachments: [],
      turnOverrideArgs: {
        turnSkillOverrides: [],
        turnIntegrationOverrides: [{ integrationId: "drive", enabled: false }],
      },
      enabledIntegrations: new Set(),
      subagentsEnabled: false,
      webSearchEnabled: false,
      isVideoMode: false,
      prefs: {
        defaultVideoAspectRatio: "9:16",
        defaultVideoDuration: 8,
        defaultVideoResolution: "1080p",
        defaultVideoGenerateAudio: false,
      },
    });

    expect(args.enabledIntegrations).toBeUndefined();
    expect(args.searchMode).toBeUndefined();
    expect(args.complexity).toBeUndefined();
    expect(args.videoConfig).toBeUndefined();
    expect(args.advisorSelections).toBeUndefined();
    expect(args.advisorBrief).toBeUndefined();
    expect(args.turnSkillOverrides).toEqual([]);
    expect(args.turnIntegrationOverrides).toEqual([{ integrationId: "drive", enabled: false }]);
  });

  it("preserves an explicit empty Advisor snapshot for a queued turn", () => {
    const common = {
      chatId,
      text: "queued without Advisors",
      participants: [participant],
      attachments: [],
      enabledIntegrations: new Set<string>(),
      advisorSelections: [],
    };

    expect(buildSendMessageArgs({
      ...common,
      turnOverrideArgs: {},
      subagentsEnabled: false,
      webSearchEnabled: false,
      isVideoMode: false,
      prefs: undefined,
    }).advisorSelections).toEqual([]);
    expect(buildResearchPaperArgs({
      ...common,
      participant,
      complexity: 1,
    }).advisorSelections).toEqual([]);
  });

  it("omits optional send fields entirely when the current turn has no active overrides", () => {
    const args = buildSendMessageArgs({
      chatId,
      text: "plain turn",
      participants: [participant],
      attachments: [],
      turnOverrideArgs: {},
      enabledIntegrations: new Set(),
      subagentsEnabled: false,
      webSearchEnabled: false,
      isVideoMode: false,
      prefs: undefined,
    });

    expect(args.enabledIntegrations).toBeUndefined();
    expect(args.turnSkillOverrides).toBeUndefined();
    expect(args.turnIntegrationOverrides).toBeUndefined();
    expect(args.searchMode).toBeUndefined();
    expect(args.complexity).toBeUndefined();
    expect(args.videoConfig).toBeUndefined();
  });

  it("builds research paper args with one participant and no video role", () => {
    const researchParticipant: Participant = {
      ...participant,
      personaName: null,
      personaEmoji: null,
      personaAvatarImageUrl: null,
      systemPrompt: null,
      temperature: 0.7,
      includeReasoning: true,
      reasoningEffort: "medium",
    };
    const args = buildResearchPaperArgs({
      chatId,
      text: "paper",
      participant: researchParticipant,
      complexity: 3,
      attachments: [imageAttachment],
      enabledIntegrations: new Set(["gmail", "drive"]),
      advisorSelections: [advisorSelection],
      advisorBrief: "Review the evidence",
    });

    expect(args).toMatchObject({
      chatId,
      text: "paper",
      participant: {
        modelId: "openai/gpt-5.2",
        personaId: null,
        personaName: null,
        personaEmoji: null,
        personaAvatarImageUrl: null,
        systemPrompt: null,
        temperature: 0.7,
        includeReasoning: true,
        reasoningEffort: "medium",
      },
      complexity: 3,
      enabledIntegrations: ["gmail", "drive"],
      advisorSelections: [advisorSelection],
      advisorBrief: "Review the evidence",
    });
    expect(args.participant).not.toHaveProperty("id");
    expect(args.attachments?.[0]).not.toHaveProperty("videoRole");
  });

  it("executes a successful normal send and clears one-turn state only after the mutation resolves", async () => {
    const deps = baseDeps();

    await expect(executeChatSend({
      text: "hello",
      state: baseState({
        selectedAttachments: [imageAttachment],
        turnOverrideArgs: {
          turnSkillOverrides: [{ skillId: "skill_1" as Id<"skills">, state: "always" }],
        },
        enabledIntegrations: new Set(["drive"]),
        advisorSelections: [advisorSelection],
        advisorBrief: "Challenge the sources",
        webSearchEnabled: true,
        convexSearchMode: "web",
        convexComplexity: 2,
      }),
      deps,
    })).resolves.toBe(true);

    expect(deps.flushPendingState).toHaveBeenCalledWith(chatId);
    expect(deps.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId,
      text: "hello",
      enabledIntegrations: ["drive"],
      turnSkillOverrides: [{ skillId: "skill_1", state: "always" }],
      searchMode: "web",
      complexity: 2,
    }));
    expect(deps.clearKBFiles).toHaveBeenCalledTimes(1);
    expect(deps.clearTurnOverrides).toHaveBeenCalledTimes(1);
  });

  it("does not clear draft-related one-turn state when sendMessage fails", async () => {
    const deps = baseDeps({
      sendMessage: vi.fn(async () => {
        throw new Error("send failed");
      }),
    });

    await expect(executeChatSend({
      text: "retry me",
      state: baseState({ selectedAttachments: [imageAttachment] }),
      deps,
    })).rejects.toThrow("send failed");

    expect(deps.clearKBFiles).not.toHaveBeenCalled();
    expect(deps.clearTurnOverrides).not.toHaveBeenCalled();
  });

  it("returns false without clearing draft state when auth or OpenRouter validation blocks send", async () => {
    const deps = baseDeps({
      validateAttachmentCount: vi.fn(() => "Complexity 3 search does not support attachments."),
    });

    await expect(executeChatSend({
      text: "blocked",
      state: baseState({ selectedAttachments: [imageAttachment] }),
      deps,
    })).resolves.toBe(false);

    expect(deps.ensureChatId).not.toHaveBeenCalled();
    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.clearKBFiles).not.toHaveBeenCalled();
    expect(deps.clearTurnOverrides).not.toHaveBeenCalled();
    const sendAttempt = analyticsMocks.captureAnalytics.mock.calls.find(([event]) => event === "message_send_attempted");
    const sendFailure = analyticsMocks.captureAnalytics.mock.calls.find(([event]) => event === "message_send_failed");
    expect(sendAttempt?.[1]).toMatchObject({ chat_id: null });
    expect(sendFailure?.[1]).toMatchObject({
      chat_id: null,
      error_label: "complexity_3_attachments",
    });
    expect(sendFailure?.[1].client_event_id).toBe(sendAttempt?.[1].client_event_id);
  });

  it("includes the existing chat id on validation failure analytics", async () => {
    const deps = baseDeps({
      validateAttachmentCount: vi.fn(() => "Research Paper requires a single participant."),
    });

    await expect(executeChatSend({
      text: "blocked",
      state: baseState({
        chatId,
        selectedAttachments: [imageAttachment],
      }),
      deps,
    })).resolves.toBe(false);

    const sendAttempt = analyticsMocks.captureAnalytics.mock.calls.find(([event]) => event === "message_send_attempted");
    const sendFailure = analyticsMocks.captureAnalytics.mock.calls.find(([event]) => event === "message_send_failed");
    expect(sendAttempt?.[1]).toMatchObject({ chat_id: String(chatId) });
    expect(sendFailure?.[1]).toMatchObject({
      chat_id: String(chatId),
      error_label: "research_paper_multi_participant",
    });
    expect(sendFailure?.[1].client_event_id).toBe(sendAttempt?.[1].client_event_id);
  });

  it("includes selected Google Drive files as turn context and clears that context after success", async () => {
    const deps = baseDeps();

    await executeChatSend({
      text: "use Drive context",
      state: baseState({
        kbAttachmentsForDisplay: [imageAttachment],
        enabledIntegrations: new Set(["drive"]),
        turnOverrideArgs: {
          turnIntegrationOverrides: [{ integrationId: "drive", enabled: true }],
        },
      }),
      deps,
    });

    expect(deps.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      enabledIntegrations: ["drive"],
      turnIntegrationOverrides: [{ integrationId: "drive", enabled: true }],
      attachments: [expect.objectContaining({
        storageId,
        driveFileId: "drive_1",
        lastRefreshedAt: 123,
      })],
    }));
    expect(deps.clearKBFiles).toHaveBeenCalledTimes(1);
    expect(deps.clearTurnOverrides).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate KB attachments already included by the composer", async () => {
    const deps = baseDeps();

    await executeChatSend({
      text: "single Drive context",
      state: baseState({
        selectedAttachments: [imageAttachment],
        kbAttachmentsForDisplay: [{ ...imageAttachment }],
        enabledIntegrations: new Set(["drive"]),
      }),
      deps,
    });

    const sendArgs = vi.mocked(deps.sendMessage).mock.calls[0]?.[0];
    expect(sendArgs?.attachments).toHaveLength(1);
    expect(sendArgs?.attachments?.[0]).toMatchObject({
      storageId,
      driveFileId: "drive_1",
    });
  });

  it("does not inherit stale Drive context on the next normal send", async () => {
    const deps = baseDeps();
    await executeChatSend({
      text: "Drive turn",
      state: baseState({
        kbAttachmentsForDisplay: [imageAttachment],
        enabledIntegrations: new Set(["drive"]),
        turnOverrideArgs: {
          turnIntegrationOverrides: [{ integrationId: "drive", enabled: true }],
        },
      }),
      deps,
    });

    await executeChatSend({
      text: "normal turn",
      state: baseState(),
      deps,
    });

    const secondArgs = vi.mocked(deps.sendMessage).mock.calls[1]?.[0];
    expect(secondArgs?.enabledIntegrations).toBeUndefined();
    expect(secondArgs?.turnIntegrationOverrides).toBeUndefined();
    expect(secondArgs?.attachments).toEqual([]);
  });

  it("keeps queued text available by not clearing state when a queued send fails", async () => {
    const deps = baseDeps({
      sendMessage: vi.fn(async () => {
        throw new Error("queued send failed");
      }),
    });

    await expect(executeChatSend({
      text: "queued follow-up",
      state: baseState(),
      deps,
    })).rejects.toThrow("queued send failed");

    expect(deps.clearKBFiles).not.toHaveBeenCalled();
    expect(deps.clearTurnOverrides).not.toHaveBeenCalled();
  });

  it("captures send failure analytics when chat creation fails before mutation", async () => {
    const deps = baseDeps({
      ensureChatId: vi.fn(async () => {
        throw new Error("create chat failed");
      }),
    });

    await expect(executeChatSend({
      text: "new chat",
      state: baseState(),
      deps,
    })).rejects.toThrow("create chat failed");

    expect(deps.flushPendingState).not.toHaveBeenCalled();
    expect(deps.sendMessage).not.toHaveBeenCalled();
    const sendAttempt = analyticsMocks.captureAnalytics.mock.calls.find(([event]) => event === "message_send_attempted");
    const sendFailure = analyticsMocks.captureAnalytics.mock.calls.find(([event]) => event === "message_send_failed");
    expect(sendAttempt?.[1]).toMatchObject({ chat_id: null });
    expect(sendFailure?.[1]).toMatchObject({
      chat_id: null,
      failure_stage: "chat_setup",
      error_label: "error",
    });
    expect(sendFailure?.[1].client_event_id).toBe(sendAttempt?.[1].client_event_id);
    expect(deps.clearKBFiles).not.toHaveBeenCalled();
    expect(deps.clearTurnOverrides).not.toHaveBeenCalled();
  });

  it("captures send failure analytics when pending state flush fails", async () => {
    const deps = baseDeps({
      flushPendingState: vi.fn(async () => {
        throw new Error("flush failed");
      }),
    });

    await expect(executeRecordedAudioSend({
      recording: {
        blob: new Blob(["voice"], { type: "audio/webm" }),
        mimeType: "audio/webm",
        durationMs: 900,
        transcript: "voice setup",
      },
      state: baseState({ chatId }),
      deps: {
        ...baseRecordingDeps(),
        ...deps,
      },
    })).rejects.toThrow("flush failed");

    expect(deps.sendMessage).not.toHaveBeenCalled();
    const sendAttempt = analyticsMocks.captureAnalytics.mock.calls.find(([event]) => event === "message_send_attempted");
    const sendFailure = analyticsMocks.captureAnalytics.mock.calls.find(([event]) => event === "message_send_failed");
    expect(sendAttempt?.[1]).toMatchObject({
      chat_id: String(chatId),
      has_audio: true,
      audio_duration_ms: 900,
    });
    expect(sendFailure?.[1]).toMatchObject({
      chat_id: String(chatId),
      failure_stage: "pending_state_flush",
      error_label: "error",
    });
    expect(sendFailure?.[1].client_event_id).toBe(sendAttempt?.[1].client_event_id);
  });

  it("does not clear one-turn state when research paper send fails", async () => {
    const deps = baseDeps({
      startResearchPaper: vi.fn(async () => {
        throw new Error("research failed");
      }),
    });

    await expect(executeChatSend({
      text: "research this",
      state: baseState({
        isResearchPaper: true,
        convexComplexity: 2,
        kbAttachmentsForDisplay: [imageAttachment],
        enabledIntegrations: new Set(["drive"]),
        advisorSelections: [advisorSelection],
        advisorBrief: "Challenge the sources",
      }),
      deps,
    })).rejects.toThrow("research failed");

    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.clearKBFiles).not.toHaveBeenCalled();
    expect(deps.clearTurnOverrides).not.toHaveBeenCalled();
    expect(deps.startResearchPaper).toHaveBeenCalledWith(expect.objectContaining({
      advisorSelections: [advisorSelection],
      advisorBrief: "Challenge the sources",
    }));
  });

  it("marks research paper sends with audio attachments as audio feature usage", async () => {
    const deps = baseDeps();

    await expect(executeChatSend({
      text: "research this audio",
      state: baseState({
        isResearchPaper: true,
        convexComplexity: 2,
        selectedAttachments: [audioAttachment],
        advisorSelections: [advisorSelection],
        advisorBrief: "Check the conclusion",
      }),
      deps,
    })).resolves.toBe(true);

    expect(analyticsMocks.captureAnalytics).toHaveBeenCalledWith(
      "message_send_attempted",
      expect.objectContaining({
        has_audio: true,
        attachment_count: 1,
        search_mode: "paper",
        advisor_count: 1,
        advisor_web_search_count: 1,
      }),
    );
    expect(analyticsMocks.captureAnalytics).toHaveBeenCalledWith(
      "message_sent",
      expect.objectContaining({
        user_message_id: "msg_user",
        assistant_message_id: "msg_assistant",
        assistant_message_count: 1,
      }),
    );
    expect(featureAnalyticsMocks.captureSendFeatureUsage).toHaveBeenCalledWith(
      expect.objectContaining({ has_audio: true }),
    );
    expect(deps.startResearchPaper).toHaveBeenCalledWith(expect.objectContaining({
      advisorSelections: [advisorSelection],
      advisorBrief: "Check the conclusion",
    }));
  });

  it("threads Advisors through recorded-audio Research sends", async () => {
    const deps = baseRecordingDeps();
    await expect(executeRecordedAudioSend({
      recording: {
        blob: new Blob(["voice"], { type: "audio/webm" }),
        mimeType: "audio/webm",
        durationMs: 800,
        transcript: "research by voice",
      },
      state: baseState({
        isResearchPaper: true,
        convexComplexity: 2,
        advisorSelections: [advisorSelection],
        advisorBrief: "Verify the claims",
      }),
      deps,
    })).resolves.toBe(true);

    expect(deps.startResearchPaper).toHaveBeenCalledWith(expect.objectContaining({
      recordedAudio: expect.objectContaining({ transcript: "research by voice" }),
      advisorSelections: [advisorSelection],
      advisorBrief: "Verify the claims",
    }));
    expect(deps.clearTurnOverrides).toHaveBeenCalledTimes(1);
  });

  it("does not silently drop one-turn state when recorded audio upload fails", async () => {
    const deps = baseRecordingDeps({
      uploadRecording: vi.fn(async () => new Response(null, { status: 500 })),
    });

    await expect(executeRecordedAudioSend({
      recording: {
        blob: new Blob(["voice"], { type: "audio/webm" }),
        mimeType: "audio/webm",
        durationMs: 1_200,
        transcript: "voice transcript",
      },
      state: baseState({
        kbAttachmentsForDisplay: [imageAttachment],
        enabledIntegrations: new Set(["drive"]),
      }),
      deps,
    })).rejects.toThrow("Voice recording upload failed.");

    expect(deps.createUploadUrl).toHaveBeenCalledTimes(1);
    expect(deps.uploadRecording).toHaveBeenCalledWith("https://uploads.example/voice", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "audio/webm" },
    }));
    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.startResearchPaper).not.toHaveBeenCalled();
    expect(deps.clearKBFiles).not.toHaveBeenCalled();
    expect(deps.clearTurnOverrides).not.toHaveBeenCalled();
    expect(analyticsMocks.captureAnalytics).toHaveBeenCalledWith(
      "message_send_failed",
      expect.objectContaining({
        chat_id: "chat_1",
        failure_stage: "upload",
        has_audio: true,
        audio_duration_ms: 1_200,
        integration_count: 1,
      }),
    );
  });

  it("uploads recorded audio and sends the returned storage id", async () => {
    const deps = baseRecordingDeps();

    await expect(executeRecordedAudioSend({
      recording: {
        blob: new Blob(["voice"], { type: "audio/webm" }),
        mimeType: "audio/webm",
        durationMs: 1_200,
        transcript: "voice transcript",
      },
      state: baseState(),
      deps,
    })).resolves.toBe(true);

    expect(deps.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: "voice transcript",
      recordedAudio: {
        storageId: "storage_voice",
        transcript: "voice transcript",
        durationMs: 1_200,
        mimeType: "audio/webm",
      },
    }));
    expect(deps.clearKBFiles).toHaveBeenCalledTimes(1);
    expect(deps.clearTurnOverrides).toHaveBeenCalledTimes(1);
  });
});
