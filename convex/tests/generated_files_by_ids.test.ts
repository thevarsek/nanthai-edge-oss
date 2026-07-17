import assert from "node:assert/strict";
import test from "node:test";

import { getGeneratedFilesByIdsHandler } from "../chat/queries_generated_files_handlers";

test("getGeneratedFilesByIds returns only caller-owned files with resolved URLs", async () => {
  const previousSiteUrl = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = "https://files.example/";
  const rows = new Map([
    ["file_owned", {
      _id: "file_owned",
      _creationTime: 1,
      userId: "user_1",
      chatId: "chat_1",
      messageId: "message_1",
      storageId: "storage_1",
      filename: "Deck.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      toolName: "create_presentation",
      presentationProjectId: "project_1",
      createdAt: 1,
    }],
    ["file_foreign", {
      _id: "file_foreign",
      _creationTime: 2,
      userId: "user_2",
      chatId: "chat_2",
      messageId: "message_2",
      storageId: "storage_2",
      filename: "Foreign.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      toolName: "generate_docx",
      createdAt: 2,
    }],
  ]);
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    db: { get: async (_table: string, id: string) => rows.get(id) ?? null },
    storage: { getUrl: async (id: string) => `https://files.example/${id}` },
  } as never;

  try {
    const result = await getGeneratedFilesByIdsHandler(ctx, {
      fileIds: ["file_owned", "file_foreign"] as never,
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?._id, "file_owned");
    assert.equal(result[0]?.presentationProjectId, "project_1");
    assert.equal(
      result[0]?.downloadUrl,
      "https://files.example/download?storageId=storage_1&filename=Deck.pptx",
    );
  } finally {
    if (previousSiteUrl === undefined) delete process.env.CONVEX_SITE_URL;
    else process.env.CONVEX_SITE_URL = previousSiteUrl;
  }
});
