import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Participant } from "@/hooks/useChat";
import {
  buildResearchPaperArgs,
  buildSendMessageArgs,
  buildVideoConfig,
  serializeChatAttachments,
  type ChatAttachment,
} from "./ChatPage.sendFlow";

const chatId = "chat_1" as Id<"chats">;
const storageId = "storage_1" as Id<"_storage">;
const participant: Participant = {
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

  it("builds research paper args with one participant and no video role", () => {
    const args = buildResearchPaperArgs({
      chatId,
      text: "paper",
      participant,
      complexity: 3,
      attachments: [imageAttachment],
      enabledIntegrations: new Set(["gmail", "drive"]),
    });

    expect(args).toMatchObject({
      chatId,
      text: "paper",
      participant,
      complexity: 3,
      enabledIntegrations: ["gmail", "drive"],
    });
    expect(args.attachments?.[0]).not.toHaveProperty("videoRole");
  });
});
