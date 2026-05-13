import assert from "node:assert/strict";
import test from "node:test";

import {
  attachmentTriggeredDocumentWorkspaceToolNames,
  attachmentTriggeredReadToolNames,
  resolveAllowedImageMessageIds,
  splitMessageAttachmentParts,
} from "../chat/helpers_attachment_utils";

test("splitMessageAttachmentParts covers image, document, audio, file, and imageUrl branches", () => {
  const { imageParts, nonImageParts } = splitMessageAttachmentParts({
    _id: "msg_1",
    role: "user",
    content: "Attachments",
    imageUrls: [" https://example.com/from-message.png ", "   ", "RAWBASE64"],
    attachments: [
      {
        type: "image",
        url: "IMAGEBASE64",
        storageId: "storage_image",
        name: "chart.png",
        mimeType: "image/png",
      },
      {
        type: "document",
        storageId: "storage_csv",
        name: "data.csv",
        mimeType: "text/csv",
      },
      {
        type: "document",
        storageId: "storage_unknown",
        name: "unknown.bin",
        mimeType: "application/octet-stream",
      },
      {
        type: "audio",
        url: "AUDIO",
        storageId: "storage_audio",
        name: "voice.m4a",
        mimeType: "audio/mp4",
      },
      {
        type: "file",
        url: "FILEBASE64",
        name: "archive.zip",
        mimeType: "application/zip",
      },
      {
        type: "file",
        name: "missing-url.zip",
        mimeType: "application/zip",
      },
    ],
  } as never);

  assert.equal(imageParts.length, 3);
  assert.equal((imageParts[0] as { image_url: { url: string } }).image_url.url, "data:image/png;base64,IMAGEBASE64");
  assert.equal((imageParts[1] as { image_url: { url: string } }).image_url.url, "https://example.com/from-message.png");
  assert.equal((imageParts[2] as { image_url: { url: string } }).image_url.url, "data:application/octet-stream;base64,RAWBASE64");

  assert.equal(nonImageParts.length, 4);
  assert.match(nonImageParts[0]?.text ?? "", /imageStorageId "storage_image"/);
  assert.match(nonImageParts[1]?.text ?? "", /read_text_file/);
  assert.match(nonImageParts[1]?.text ?? "", /data_python_exec/);
  assert.match(nonImageParts[2]?.text ?? "", /read_docx/);
  assert.equal(nonImageParts[3]?.type, "file");
  assert.equal(nonImageParts[3]?.file?.file_data, "data:application/zip;base64,FILEBASE64");
});

test("attachment-triggered read tools and workspace tools cover extension fallbacks and exclusions", () => {
  assert.deepEqual(
    attachmentTriggeredReadToolNames([
      { type: "document", storageId: "s1", name: "brief.DOCX", mimeType: "application/octet-stream" },
      { type: "document", storageId: "s2", name: "sheet.XLSX", mimeType: "application/octet-stream" },
      { type: "document", storageId: "s3", name: "slides.PPTX", mimeType: "application/octet-stream" },
      { type: "document", storageId: "s4", name: "notes.MD", mimeType: "application/octet-stream" },
      { type: "document", storageId: "s5", name: "thread.EML", mimeType: "application/octet-stream" },
      { type: "document", name: "missing-storage.txt", mimeType: "text/plain" },
      { type: "image", storageId: "s6", name: "photo.png", mimeType: "image/png" },
    ] as never).sort(),
    ["read_docx", "read_eml", "read_pptx", "read_text_file", "read_xlsx"],
  );

  assert.deepEqual(attachmentTriggeredReadToolNames(undefined), []);
  assert.deepEqual(attachmentTriggeredDocumentWorkspaceToolNames(undefined), []);
  assert.deepEqual(attachmentTriggeredDocumentWorkspaceToolNames([
    { type: "document", storageId: "s7", name: "table.tsv", mimeType: "text/tab-separated-values" },
  ] as never), ["list_documents", "read_document", "find_in_document"]);
});

test("document attachment prompts select MIME-aware read and edit workflows", () => {
  const { nonImageParts } = splitMessageAttachmentParts({
    _id: "msg_docs",
    role: "user",
    content: "Docs",
    attachments: [
      { type: "document", storageId: "xlsx", name: "sheet.bin", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { type: "document", storageId: "pptx", name: "deck.bin", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
      { type: "document", storageId: "pdf", name: "paper.unknown", mimeType: "application/pdf" },
      { type: "document", storageId: "tsv", name: "table.tsv", mimeType: "application/octet-stream" },
      { type: "document", storageId: "txt", name: "notes.txt", mimeType: "application/octet-stream" },
      { type: "document", storageId: "eml", name: "mail.bin", mimeType: "message/rfc822" },
    ],
  } as never);

  const text = nonImageParts.map((part) => part.text ?? "").join("\n");
  assert.match(text, /read_xlsx/);
  assert.match(text, /edit_xlsx/);
  assert.match(text, /read_pptx/);
  assert.match(text, /edit_pptx/);
  assert.match(text, /read_document/);
  assert.match(text, /\/tmp\/inputs\/table.tsv/);
  assert.match(text, /read_text_file/);
  assert.match(text, /read_eml/);
});

test("resolveAllowedImageMessageIds keeps the newest assistant image per participant identity", () => {
  const allowed = resolveAllowedImageMessageIds([
    {
      _id: "user_ignored",
      role: "user",
      imageUrls: ["https://example.com/user.png"],
    },
    {
      _id: "assistant_model_old",
      role: "assistant",
      modelId: "model-a",
      imageUrls: ["https://example.com/old.png"],
    },
    {
      _id: "assistant_name_old",
      role: "assistant",
      participantName: "Named",
      imageUrls: ["https://example.com/name-old.png"],
    },
    {
      _id: "assistant_default_old",
      role: "assistant",
      imageUrls: ["https://example.com/default-old.png"],
    },
    {
      _id: "assistant_persona",
      role: "assistant",
      participantId: "persona_1",
      attachments: [{ type: "image", url: "https://example.com/persona.png" }],
    },
    {
      _id: "assistant_auto",
      role: "assistant",
      autonomousParticipantId: " auto_1 ",
      imageUrls: ["https://example.com/auto.png"],
    },
    {
      _id: "assistant_model_new",
      role: "assistant",
      modelId: "model-a",
      imageUrls: ["https://example.com/new.png"],
    },
    {
      _id: "assistant_name_new",
      role: "assistant",
      participantName: "Named",
      imageUrls: ["https://example.com/name-new.png"],
    },
    {
      _id: "assistant_default_new",
      role: "assistant",
      imageUrls: ["https://example.com/default-new.png"],
    },
  ] as never);

  assert.deepEqual(
    Array.from(allowed).sort(),
    [
      "assistant_auto",
      "assistant_default_new",
      "assistant_model_new",
      "assistant_name_new",
      "assistant_persona",
    ],
  );
});
