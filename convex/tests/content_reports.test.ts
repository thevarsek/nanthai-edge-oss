import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import { submitContentReportHandler } from "../content_reports/handlers";
import type { SubmitContentReportArgs } from "../content_reports/validators";

const messageId = "message_1" as Id<"messages">;
const chatId = "chat_1" as Id<"chats">;
const reportId = "report_1" as Id<"aiContentReports">;

function args(overrides: Partial<SubmitContentReportArgs> = {}): SubmitContentReportArgs {
  return {
    messageId,
    reason: "hate_or_harassment",
    platform: "android",
    appVersion: "2.3.0",
    buildNumber: "20300",
    ...overrides,
  };
}

function context(options: {
  userId?: string;
  role?: "user" | "assistant" | "system";
  existing?: boolean;
  inserted?: (value: Record<string, unknown>) => void;
} = {}) {
  const userId = options.userId ?? "user_1";
  const message = {
    _id: messageId,
    chatId,
    userId: "user_1",
    role: options.role ?? "assistant",
    content: "  Generated response to review  ",
    status: "completed",
    modelId: "openai/gpt-5",
    participantName: "GPT-5",
    imageUrls: ["https://example.test/image.png"],
    videoUrls: [],
    attachments: [{
      type: "file",
      name: "report.pdf",
      mimeType: "application/pdf",
      url: "https://example.test/report.pdf",
    }],
  };
  return {
    auth: {
      getUserIdentity: async () => ({ subject: userId }),
    },
    db: {
      get: async (id: string) => {
        if (id === messageId) return message;
        if (id === chatId) return { _id: chatId, userId: "user_1" };
        return null;
      },
      query: () => ({
        withIndex: () => ({
          unique: async () => options.existing ? { _id: reportId } : null,
        }),
      }),
      insert: async (_table: string, value: Record<string, unknown>) => {
        options.inserted?.(value);
        return reportId;
      },
    },
  };
}

test("content report snapshots the owned AI response and media server-side", async () => {
  let inserted: Record<string, unknown> | undefined;
  const result = await submitContentReportHandler(
    context({ inserted: (value) => { inserted = value; } }) as never,
    args({ details: "  Harassing language  " }),
  );

  assert.deepEqual(result, { reportId, alreadyReported: false });
  assert.equal(inserted?.userId, "user_1");
  assert.equal(inserted?.messageId, messageId);
  assert.equal(inserted?.contentSnapshot, "Generated response to review");
  assert.deepEqual(inserted?.contentKinds, ["text", "image", "file"]);
  assert.deepEqual(inserted?.imageUrls, ["https://example.test/image.png"]);
  assert.equal(inserted?.details, "Harassing language");
  assert.equal(inserted?.status, "open");
});

test("content report submission is idempotent per user and message", async () => {
  const result = await submitContentReportHandler(
    context({ existing: true }) as never,
    args(),
  );

  assert.deepEqual(result, { reportId, alreadyReported: true });
});

test("content reports reject foreign users and non-assistant messages", async () => {
  for (const ctx of [
    context({ userId: "user_2" }),
    context({ role: "user" }),
  ]) {
    await assert.rejects(
      submitContentReportHandler(ctx as never, args()),
      (error: unknown) => {
        assert.equal((error as { data?: { code?: string } }).data?.code, "NOT_FOUND");
        return true;
      },
    );
  }
});

test("content report details are bounded", async () => {
  await assert.rejects(
    submitContentReportHandler(
      context() as never,
      args({ details: "x".repeat(1_001) }),
    ),
    (error: unknown) => {
      assert.equal((error as { data?: { code?: string } }).data?.code, "VALIDATION");
      return true;
    },
  );
});
