import assert from "node:assert/strict";
import test from "node:test";

import {
  sweepUnreferencedUploadsHandler,
  UNREFERENCED_UPLOAD_RETENTION_MS,
} from "../storage_upload_sweep";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";

const NOW = Date.UTC(2026, 10, 16, 12);
const OLD = NOW - UNREFERENCED_UPLOAD_RETENTION_MS - 1;

function upload(id: string, storageId: string | undefined, extra: Record<string, unknown> = {}) {
  return { _id: id, userId: "user_1", storageId, sweepEligible: true, createdAt: OLD, ...extra };
}

test("sweep deletes abandoned uploads and keeps anything a durable record references", async () => {
  const rows: Record<string, any[]> = {
    clientStorageUploads: [
      upload("abandoned", "blob_abandoned"),
      upload("attached", "blob_attached"),
      upload("kb_document", "blob_kb"),
      upload("avatar", "blob_avatar"),
      upload("pending_chat_upload", "blob_pending"),
      upload("cancelled_chat_upload", "blob_cancelled"),
      upload("expired_token", undefined, { tokenHash: "hash", uploadUrl: "https://upload.example" }),
      upload("recent", "blob_recent", { createdAt: NOW - 60_000 }),
      upload("legacy", "blob_legacy", { sweepEligible: undefined }),
    ],
    fileAttachments: [{ _id: "fa", userId: "user_1", storageId: "blob_attached" }],
    documents: [{ _id: "doc", userId: "user_1", sourceStorageId: "blob_kb" }],
    personas: [{ _id: "persona", userId: "user_1", avatarImageStorageId: "blob_avatar" }],
    chatUploadSessions: [
      { _id: "s1", userId: "user_1", storageId: "blob_pending", status: "pending" },
      { _id: "s2", userId: "user_1", storageId: "blob_cancelled", status: "cancelled" },
    ],
    userDailyUsage: [],
  };
  const ctx = createStatefulMockCtx(rows);

  const result = await sweepUnreferencedUploadsHandler(ctx as any, NOW);

  assert.deepEqual(result, { deletedBlobs: 2, keptBlobs: 4, expiredTokens: 1, prunedUsageRows: 0 });
  assert.deepEqual(ctx.storageDeletes.sort(), ["blob_abandoned", "blob_cancelled"]);
  const remaining = new Map(rows.clientStorageUploads.map((row) => [row._id, row]));
  assert.deepEqual([...remaining.keys()].sort(), ["attached", "avatar", "kb_document", "legacy", "pending_chat_upload", "recent"]);
  // Referenced rows leave the sweep for good; recent and legacy rows are untouched.
  for (const id of ["attached", "avatar", "kb_document", "pending_chat_upload"]) {
    assert.equal(remaining.get(id)?.sweepEligible, undefined, id);
  }
  assert.equal(remaining.get("recent")?.sweepEligible, true);

  const second = await sweepUnreferencedUploadsHandler(ctx as any, NOW);
  assert.deepEqual(second, { deletedBlobs: 0, keptBlobs: 0, expiredTokens: 0, prunedUsageRows: 0 });
});
