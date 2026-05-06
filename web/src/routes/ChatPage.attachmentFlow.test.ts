import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";
import {
  attachmentsWithVideoRoles,
  buildKnowledgeBaseAttachments,
  generatedDocumentSuggestion,
  pruneVideoRoleOverrides,
} from "./ChatPage.attachmentFlow";
import type { ChatAttachment } from "./ChatPage.sendFlow";

const storageA = "storage_a" as Id<"_storage">;
const storageB = "storage_b" as Id<"_storage">;

describe("ChatPage attachment flow helpers", () => {
  it("projects selected Knowledge Base files into send attachments", () => {
    expect(buildKnowledgeBaseAttachments([{
      storageId: storageA,
      filename: "report.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 128,
      driveFileId: "drive_1",
      lastRefreshedAt: 123,
    }])).toEqual([{
      type: "document",
      storageId: storageA,
      name: "report.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 128,
      driveFileId: "drive_1",
      lastRefreshedAt: 123,
    }]);
  });

  it("prunes video role overrides for files that are no longer selected", () => {
    expect(pruneVideoRoleOverrides({
      [storageA]: "first_frame",
      stale_storage: "last_frame",
    }, [imageAttachment(storageA)])).toEqual({
      [storageA]: "first_frame",
    });
  });

  it("preserves override object identity when no role pruning is needed", () => {
    const overrides = { [storageA]: "first_frame" as const };

    expect(pruneVideoRoleOverrides(overrides, [imageAttachment(storageA)])).toBe(overrides);
  });

  it("assigns video role defaults to image attachments and preserves explicit overrides", () => {
    expect(attachmentsWithVideoRoles({
      attachments: [imageAttachment(storageA), imageAttachment(storageB), imageAttachment("storage_c" as Id<"_storage">)],
      roleOverrides: { [storageB]: "reference" },
      isVideoMode: true,
      supportsFrameImages: true,
    }).map((attachment) => attachment.videoRole)).toEqual(["first_frame", "reference", "reference"]);
  });

  it("does not invent frame roles outside video frame-image mode", () => {
    expect(attachmentsWithVideoRoles({
      attachments: [imageAttachment(storageA)],
      roleOverrides: {},
      isVideoMode: false,
      supportsFrameImages: false,
    })[0]?.videoRole).toBeUndefined();
  });

  it("returns newest assistant generated document suggestion", () => {
    const messages = [
      message("assistant_old", "storage_old" as Id<"_storage">, 1),
      message("assistant_new", storageA, 2),
    ];

    expect(generatedDocumentSuggestion(messages)).toMatchObject({
      storageId: storageA,
      name: "assistant_new.pdf",
      type: "pdf",
      mimeType: "application/pdf",
    });
  });
});

function imageAttachment(storageId: Id<"_storage">): ChatAttachment {
  return {
    type: "image",
    storageId,
    name: `${storageId}.png`,
    mimeType: "image/png",
  };
}

function message(id: string, storageId: Id<"_storage">, createdAt: number): Message {
  return {
    _id: id as Id<"messages">,
    _creationTime: createdAt,
    chatId: "chat_1" as Id<"chats">,
    role: "assistant",
    content: "",
    status: "completed",
    createdAt,
    documentEvents: [{
      type: "document_created",
      documentId: "doc_1" as Id<"documents">,
      storageId,
      filename: `${id}.pdf`,
      mimeType: "application/pdf",
    }],
  };
}
