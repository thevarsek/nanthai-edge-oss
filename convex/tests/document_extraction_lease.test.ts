import assert from "node:assert/strict";
import test from "node:test";

import {
  claimVersionExtractionHandler,
  updateVersionExtractionHandler,
} from "../documents/extraction_mutations";

function extractionContext(initial: Record<string, unknown>) {
  const version = { ...initial };
  const patches: Array<Record<string, unknown>> = [];
  return {
    version,
    patches,
    ctx: {
      db: {
        get: async (id: string) => id === version._id ? version : null,
        patch: async (_id: string, patch: Record<string, unknown>) => {
          patches.push(patch);
          Object.assign(version, patch);
        },
      },
    } as never,
  };
}

test("one live extraction lease prevents a second paid dispatch", async () => {
  const state = extractionContext({
    _id: "version_1",
    documentId: "document_1",
    userId: "user_1",
    extractionStatus: "pending",
  });
  const first = await claimVersionExtractionHandler(state.ctx, {
    versionId: "version_1" as never,
    userId: "user_1",
    leaseOwner: "owner_1",
    now: 100,
    leaseExpiresAt: 1_000,
  });
  const second = await claimVersionExtractionHandler(state.ctx, {
    versionId: "version_1" as never,
    userId: "user_1",
    leaseOwner: "owner_2",
    now: 200,
    leaseExpiresAt: 1_100,
  });

  assert.deepEqual(first, { state: "claimed" });
  assert.deepEqual(second, { state: "busy", leaseExpiresAt: 1_000 });
  assert.equal(state.patches.length, 1);
});

test("an expired extraction lease can be reclaimed", async () => {
  const state = extractionContext({
    _id: "version_1",
    documentId: "document_1",
    userId: "user_1",
    extractionStatus: "extracting",
    extractionLeaseOwner: "stale_owner",
    extractionLeaseExpiresAt: 100,
  });
  const result = await claimVersionExtractionHandler(state.ctx, {
    versionId: "version_1" as never,
    userId: "user_1",
    leaseOwner: "new_owner",
    now: 101,
    leaseExpiresAt: 1_000,
  });

  assert.deepEqual(result, { state: "claimed" });
  assert.equal(state.version.extractionLeaseOwner, "new_owner");
});

test("a stale lease owner cannot publish extraction state", async () => {
  const state = extractionContext({
    _id: "version_1",
    documentId: "document_1",
    userId: "user_1",
    extractionStatus: "extracting",
    extractionLeaseOwner: "current_owner",
    extractionLeaseExpiresAt: 1_000,
  });
  const committed = await updateVersionExtractionHandler(state.ctx, {
    versionId: "version_1" as never,
    leaseOwner: "stale_owner",
    status: "ready",
    extractionMethod: "mistral_ocr",
    extractionTextStorageId: "text_1" as never,
  });

  assert.equal(committed, false);
  assert.equal(state.patches.length, 0);
  assert.equal(state.version.extractionStatus, "extracting");
});

test("a ready extraction is reused unless its cache is explicitly reclaimed", async () => {
  const state = extractionContext({
    _id: "version_1",
    documentId: "document_1",
    userId: "user_1",
    extractionStatus: "ready",
    extractionTextStorageId: "empty_text",
  });
  const ready = await claimVersionExtractionHandler(state.ctx, {
    versionId: "version_1" as never,
    userId: "user_1",
    leaseOwner: "owner_1",
    now: 100,
    leaseExpiresAt: 1_000,
  });
  const reclaimed = await claimVersionExtractionHandler(state.ctx, {
    versionId: "version_1" as never,
    userId: "user_1",
    leaseOwner: "owner_1",
    now: 100,
    leaseExpiresAt: 1_000,
    allowReadyReclaim: true,
  });

  assert.deepEqual(ready, { state: "ready" });
  assert.deepEqual(reclaimed, { state: "claimed" });
});
