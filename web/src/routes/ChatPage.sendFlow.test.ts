import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Participant } from "@/hooks/useChat";
import {
  buildResearchPaperArgs,
  buildSendMessageArgs,
  buildVideoConfig,
  dedupeChatAttachments,
  executeChatSend,
  serializeChatAttachments,
  type ChatAttachment,
  type ChatSendOrchestrationDeps,
  type ChatSendOrchestrationState,
} from "./ChatPage.sendFlow";

const chatId = "chat_1" as Id<"chats">;
const storageId = "storage_1" as Id<"_storage">;
const participant: Participant = {
  id: "participant_1",
  modelId: "openai/gpt-5.2",
  personaId: null,
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
    validateAttachmentCount: vi.fn(() => true),
    ensureChatId: vi.fn(async () => chatId),
    flushPendingState: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => ({ userMessageId: "msg_user", assistantMessageIds: [] })),
    startResearchPaper: vi.fn(async () => null),
    clearKBFiles: vi.fn(),
    clearTurnOverrides: vi.fn(),
    ...overrides,
  };
}

describe("ChatPage send flow helpers", () => {
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
      subagentsEnabled: true,
      webSearchEnabled: true,
      convexSearchMode: "web",
      convexComplexity: 2,
      isVideoMode: true,
      prefs: undefined,
    });

    expect(args).toMatchObject({
      chatId,
      text: "hello",
      participants: [participant],
      enabledIntegrations: ["gmail", "drive"],
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
    expect(args.turnSkillOverrides).toEqual([]);
    expect(args.turnIntegrationOverrides).toEqual([{ integrationId: "drive", enabled: false }]);
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
      validateAttachmentCount: vi.fn(() => false),
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
      }),
      deps,
    })).rejects.toThrow("research failed");

    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.clearKBFiles).not.toHaveBeenCalled();
    expect(deps.clearTurnOverrides).not.toHaveBeenCalled();
  });
});
