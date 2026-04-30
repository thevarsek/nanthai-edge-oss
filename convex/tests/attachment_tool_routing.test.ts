import assert from "node:assert/strict";
import test from "node:test";

import {
  attachmentTriggeredDocumentWorkspaceToolNames,
  attachmentTriggeredReadToolNames,
  splitMessageAttachmentParts,
} from "../chat/helpers_attachment_utils";

test("attachmentTriggeredReadToolNames maps known attachment formats to lightweight read tools", () => {
  const toolNames = attachmentTriggeredReadToolNames([
    {
      type: "document",
      storageId: "storage_txt",
      name: "notes.txt",
      mimeType: "text/plain",
    },
    {
      type: "document",
      storageId: "storage_docx",
      name: "brief.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    {
      type: "document",
      storageId: "storage_xlsx",
      name: "model.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    {
      type: "document",
      storageId: "storage_pptx",
      name: "deck.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    },
    {
      type: "document",
      storageId: "storage_eml",
      name: "thread.eml",
      mimeType: "message/rfc822",
    },
  ] as any);

  assert.deepEqual(
    toolNames.sort(),
    ["read_docx", "read_eml", "read_pptx", "read_text_file", "read_xlsx"],
  );
});

test("attachmentTriggeredReadToolNames ignores attachments without a direct lightweight read tool", () => {
  const toolNames = attachmentTriggeredReadToolNames([
    {
      type: "image",
      storageId: "storage_image",
      name: "photo.png",
      mimeType: "image/png",
    },
    {
      type: "document",
      storageId: "storage_pdf",
      name: "scan.pdf",
      mimeType: "application/pdf",
    },
  ] as any);

  assert.deepEqual(toolNames, []);
});

test("attachmentTriggeredDocumentWorkspaceToolNames exposes scoped document tools for readable attachments", () => {
  const toolNames = attachmentTriggeredDocumentWorkspaceToolNames([
    {
      type: "document",
      storageId: "storage_pdf",
      name: "contract.pdf",
      mimeType: "application/pdf",
    },
  ] as any);

  assert.deepEqual(
    toolNames,
    ["list_documents", "read_document", "find_in_document"],
  );
});

test("attachmentTriggeredDocumentWorkspaceToolNames ignores unreadable attachments", () => {
  const toolNames = attachmentTriggeredDocumentWorkspaceToolNames([
    {
      type: "image",
      storageId: "storage_image",
      name: "photo.png",
      mimeType: "image/png",
    },
  ] as any);

  assert.deepEqual(toolNames, []);
});

test("splitMessageAttachmentParts points stored PDFs at scoped document tools", () => {
  const { nonImageParts } = splitMessageAttachmentParts({
    _id: "msg_1",
    role: "user",
    content: "Please review this.",
    attachments: [{
      type: "document",
      storageId: "storage_pdf",
      name: "contract.pdf",
      mimeType: "application/pdf",
    }],
  } as any);

  assert.equal(nonImageParts.length, 1);
  assert.equal(nonImageParts[0]?.type, "text");
  assert.match(nonImageParts[0]?.text ?? "", /use the read_document tool/);
  assert.doesNotMatch(nonImageParts[0]?.text ?? "", /read_docx/);
});
