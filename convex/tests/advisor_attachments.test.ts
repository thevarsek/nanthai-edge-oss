import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ADVISOR_INLINE_FILE_BYTES,
  prepareAdvisorAttachmentMessages,
} from "../advisors/attachments";
import { advisorResponsesInput } from "../advisors/responses_input";
import type { MessageWithStoredAttachments } from "../chat/action_image_helpers";
import { hydrateAttachmentsForRequest } from "../chat/action_image_helpers";
import { buildRequestMessages } from "../chat/helpers";
import type { ContextMessage } from "../chat/helpers_types";

function message(
  id: string,
  attachments: NonNullable<MessageWithStoredAttachments["attachments"]>,
): MessageWithStoredAttachments {
  return {
    _id: id as MessageWithStoredAttachments["_id"],
    role: "user",
    content: id,
    attachments,
  };
}

test("Advisor files are bounded across context and prioritize the newest turn", () => {
  const sixMegabytes = 6 * 1024 * 1024;
  const result = prepareAdvisorAttachmentMessages([
    message("old", [{
      type: "document",
      url: "",
      storageId: "storage_old" as NonNullable<MessageWithStoredAttachments["attachments"]>[number]["storageId"],
      name: "old.pdf",
      mimeType: "application/pdf",
      sizeBytes: sixMegabytes,
    }]),
    message("latest", [
      {
        type: "image",
        url: "https://example.test/image.png",
        name: "image.png",
      },
      {
        type: "document",
        url: "",
        storageId: "storage_latest" as NonNullable<MessageWithStoredAttachments["attachments"]>[number]["storageId"],
        name: "latest.pdf",
        mimeType: "application/pdf",
        sizeBytes: sixMegabytes,
      },
    ]),
  ], true);

  assert.deepEqual(result[0]?.attachments, []);
  assert.equal(result[1]?.attachments?.[0]?.type, "image");
  assert.equal(result[1]?.attachments?.[1]?.type, "file");
  assert.ok(sixMegabytes <= MAX_ADVISOR_INLINE_FILE_BYTES);
});

test("unsupported and unbounded stored files are omitted without dropping images", () => {
  const attachments = [
    { type: "image", url: "https://example.test/image.png" },
    {
      type: "document",
      url: "",
      storageId: "storage_unknown" as NonNullable<MessageWithStoredAttachments["attachments"]>[number]["storageId"],
      name: "unknown.pdf",
    },
  ];

  const unsupported = prepareAdvisorAttachmentMessages([
    message("message", attachments),
  ], false);
  assert.deepEqual(unsupported[0]?.attachments, [attachments[0]]);

  const unbounded = prepareAdvisorAttachmentMessages([
    message("message", attachments),
  ], true);
  assert.deepEqual(unbounded[0]?.attachments, [attachments[0]]);
});

test("a bounded stored document reaches the Advisor request as input_file", async () => {
  const userMessage = {
    ...message("user_message", [{
      type: "document",
      url: "",
      storageId: "storage_pdf" as NonNullable<MessageWithStoredAttachments["attachments"]>[number]["storageId"],
      name: "brief.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
    }]),
    chatId: "chat_1",
    parentMessageIds: [],
    status: "completed",
    createdAt: 1,
  };
  const assistantMessage = {
    _id: "assistant_message",
    chatId: "chat_1",
    role: "assistant",
    content: "",
    parentMessageIds: ["user_message"],
    status: "pending",
    createdAt: 2,
  } as unknown as MessageWithStoredAttachments;
  const prepared = prepareAdvisorAttachmentMessages(
    [userMessage, assistantMessage],
    true,
  );
  const hydrated = await hydrateAttachmentsForRequest({
    storage: {
      store: async () => "unused" as never,
      get: async () => new Blob([new Uint8Array([1, 2, 3, 4])]),
      getUrl: async () => null,
    },
  }, prepared, { inlineStoredNonImageAttachments: true });
  const requestMessages = buildRequestMessages({
    messages: hydrated as unknown as ContextMessage[],
    excludeMessageId: "assistant_message" as ContextMessage["_id"],
  });
  const input = advisorResponsesInput(requestMessages, [], "Review", {
    allowFiles: true,
  });

  assert.match(JSON.stringify(input), /input_file/);
  assert.match(JSON.stringify(input), /data:application\/pdf;base64,AQIDBA==/);
});

test("actual Blob size blocks understated files before arrayBuffer expansion", async () => {
  let expanded = false;
  const prepared = prepareAdvisorAttachmentMessages([
    message("message", [{
      type: "document",
      url: "",
      storageId: "storage_large" as NonNullable<MessageWithStoredAttachments["attachments"]>[number]["storageId"],
      name: "large.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
    }]),
  ], true);
  const oversizedBlob = {
    size: MAX_ADVISOR_INLINE_FILE_BYTES + 1,
    arrayBuffer: async () => {
      expanded = true;
      return new ArrayBuffer(0);
    },
  } as Blob;

  const hydrated = await hydrateAttachmentsForRequest({
    storage: {
      store: async () => "unused" as never,
      get: async () => oversizedBlob,
      getUrl: async () => null,
    },
  }, prepared, {
    inlineStoredNonImageAttachments: true,
    maxTotalStoredNonImageBytes: MAX_ADVISOR_INLINE_FILE_BYTES,
  });

  assert.equal(expanded, false);
  assert.equal(hydrated[0]?.attachments?.[0]?.url, "");
});
