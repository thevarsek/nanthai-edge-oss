import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { attachPickedDriveFiles } from "../drive_picker/actions";
import { MAX_TOTAL_ATTACHMENT_BYTES } from "../drive_picker/ingest";

const getBatchRef = getFunctionName(
  internal.drive_picker.mutations.getBatchForUser,
);
const signalWorkflowResumeRef = getFunctionName(
  internal.drive_picker.ownership.signalWorkflowResume,
);
const getConnectionRef = getFunctionName(
  internal.oauth.google.getConnectionInternal,
);
const getGrantRef = getFunctionName(
  internal.oauth.google.getDriveFileGrantInternal,
);

function response(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    arrayBuffer: async () => new Uint8Array(10).buffer,
  };
}

function connection() {
  return {
    _id: "google_1",
    userId: "user_1",
    provider: "google",
    accessToken: "access_token",
    refreshToken: "refresh_token",
    expiresAt: Date.now() + 60 * 60 * 1_000,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    status: "active",
    connectedAt: 1,
  };
}

test("failed Workflow resume signals retry without a generation fallback", async () => {
  const originalFetch = globalThis.fetch;
  const scheduled: Array<{ delay: number; ref: string }> = [];
  let signalCalls = 0;
  globalThis.fetch = (async () => response(200, {
    id: "drive_1",
    name: "Brief.pdf",
    mimeType: "application/pdf",
    modifiedTime: "2026-05-11T10:00:00.000Z",
    size: "10",
  })) as never;
  try {
    const result = await (attachPickedDriveFiles as any)._handler({
      auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
      runQuery: async (ref: unknown) => {
        const name = getFunctionName(ref as never);
        if (name === getBatchRef) return {
          userId: "user_1",
          status: "awaiting_pick",
          paramsSnapshot: { workflowResumeEventId: "event_1" },
        };
        if (name === getConnectionRef) return connection();
        if (name === getGrantRef) return null;
        if (name.endsWith("deletion_state:isAccountDeletionStarted")) return false;
        throw new Error(`unexpected query ${name}`);
      },
      runMutation: async (ref: unknown, args: Record<string, unknown>) => {
        if (getFunctionName(ref as never) === signalWorkflowResumeRef) {
          signalCalls += 1;
          return false;
        }
        if ("attachments" in args) {
          return {
            chatId: "chat_1",
            userMessageId: "message_user",
            assistantMessageIds: ["message_assistant"],
            generationJobIds: ["generation_1"],
            participant: { modelId: "openai/gpt-5" },
            userId: "user_1",
            paramsSnapshot: { workflowResumeEventId: "event_1" },
          };
        }
        return null;
      },
      scheduler: {
        runAfter: async (delay: number, ref: unknown) => {
          scheduled.push({ delay, ref: getFunctionName(ref as never) });
          return "scheduled_1";
        },
      },
      storage: {
        store: async () => "storage_1",
        getUrl: async () => "https://storage.example/storage_1",
      },
    }, { batchId: "batch_1", fileIds: ["drive_1"] });

    assert.equal(result.status, "resuming");
    assert.equal(signalCalls, 1);
    assert.deepEqual(scheduled, [{
      delay: 500,
      ref: getFunctionName(internal.drive_picker.ownership.retryWorkflowResumeGate),
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("empty and oversized selections cancel without a generation fallback", async () => {
  const scheduled: unknown[] = [];
  const mutations: Array<Record<string, unknown>> = [];
  const base = {
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as never);
      if (name === getBatchRef) return {
        userId: "user_1",
        status: "awaiting_pick",
        paramsSnapshot: { workflowResumeEventId: "event_1" },
      };
      if (name === getConnectionRef) return connection();
      if (name.endsWith("deletion_state:isAccountDeletionStarted")) return false;
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      return false;
    },
    scheduler: {
      runAfter: async (...args: unknown[]) => {
        scheduled.push(args);
        return "scheduled_1";
      },
    },
  };

  const empty = await (attachPickedDriveFiles as any)._handler(base, {
    batchId: "batch_1",
    fileIds: ["", " "],
  });
  assert.equal(empty.status, "cancelled");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => response(200, {
    id: "drive_huge",
    name: "Huge.mov",
    mimeType: "video/mp4",
    modifiedTime: "2026-05-11T10:00:00.000Z",
    size: String(MAX_TOTAL_ATTACHMENT_BYTES + 1),
  })) as never;
  try {
    await assert.rejects(
      () => (attachPickedDriveFiles as any)._handler(base, {
        batchId: "batch_1",
        fileIds: ["drive_huge"],
      }),
      (error) => error instanceof ConvexError
        && (error.data as { code?: string }).code === "DRIVE_FILE_TOO_LARGE",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(scheduled.length, 0);
  assert.ok(mutations.filter((args) => "batchId" in args).length >= 2);
});
