import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";

import { internal } from "../_generated/api";
import {
  createMemoryImportDepsForTest,
  extractImportCandidatesHandler,
} from "../memory/operations_import_handlers";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

const checkProStatusRef = getFunctionName(internal.preferences.queries.checkProStatus);
const getUserMemoriesRef = getFunctionName(internal.chat.queries.getUserMemories);

test("extractImportCandidatesHandler requires Pro", async () => {
  const deps = createMemoryImportDepsForTest({
    requireAuth: async () => ({ userId: "user_1" }),
  });

  const ctx = createMockCtx({
    runQuery: async (ref: unknown) =>
      getFunctionName(ref as any) === checkProStatusRef ? false : null,
  });

  await assert.rejects(
    () =>
      extractImportCandidatesHandler(ctx, {
        files: [],
      }, deps),
    /PRO_REQUIRED/,
  );
});

test("extractImportCandidatesHandler handles text, pdf, and docx imports while filtering duplicates and contact details", async () => {
  const openRouterCalls: Array<{ messages: unknown; params: Record<string, unknown> }> = [];

  const deps = createMemoryImportDepsForTest({
    requireAuth: async () => ({ userId: "user_1" }),
    getRequiredUserOpenRouterApiKey: async () => "key",
    extractDocxContent: async () => ({
      text: "User writes board updates.",
      markdown: "",
      paragraphs: [],
      wordCount: 4,
    }),
    callOpenRouterNonStreaming: async (
      _apiKey: unknown,
      _modelId: unknown,
      messages: unknown,
      params: unknown,
    ) => {
      openRouterCalls.push({
        messages,
        params: params as Record<string, unknown>,
      });
      const joined = JSON.stringify(messages);
      if (joined.includes("profile.pdf")) {
        return {
          content:
            '[{"content":"User phone: +44 1234 555555","category":"identity"},{"content":"User leads product teams","category":"work"}]',
          usage: null,
          finishReason: "stop",
          audioBase64: "",
          audioTranscript: "",
          generationId: null,
        };
      }
      if (joined.includes("resume.docx")) {
        return {
          content:
            '[{"content":"User leads product teams","category":"work"},{"content":"User writes concise board updates","category":"writingStyle"}]',
          usage: null,
          finishReason: "stop",
          audioBase64: "",
          audioTranscript: "",
          generationId: null,
        };
      }
      return {
        content:
          '[{"content":"User prefers concise updates","category":"preferences"},{"content":"User email: dino@example.com","category":"identity"}]',
        usage: null,
        finishReason: "stop",
        audioBase64: "",
        audioTranscript: "",
        generationId: null,
      };
    },
  });

  const blob = new Blob(["hello"], { type: "text/plain" });
  const ctx = createMockCtx({
    runQuery: async (ref: unknown) => {
      const refKey = getFunctionName(ref as any);
      if (refKey === checkProStatusRef) {
        return true;
      }
      if (refKey === getUserMemoriesRef) {
        return [{ content: "User leads product teams." }];
      }
      throw new Error("unexpected query");
    },
    storage: {
      get: async (storageId: string) => (storageId === "missing" ? null : blob),
    },
  });

  const result = await extractImportCandidatesHandler(
    ctx,
    {
      files: [
        {
          storageId: "text_1" as any,
          filename: "notes.txt",
          mimeType: "text/plain",
          textContent: "User prefers concise updates.",
        },
        {
          storageId: "pdf_1" as any,
          filename: "profile.pdf",
          mimeType: "application/pdf",
        },
        {
          storageId: "docx_1" as any,
          filename: "resume.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        {
          storageId: "missing" as any,
          filename: "missing.txt",
          mimeType: "text/plain",
        },
      ],
    },
    deps,
  );

  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((row) => row.content),
    [
      "User prefers concise updates.",
      "User writes concise board updates.",
    ],
  );
  assert.equal(
    ((openRouterCalls[1]?.params as { plugins?: Array<{ id: string }> })?.plugins?.[0]?.id),
    "file-parser",
  );
});

test("extractImportCandidatesHandler caps accepted candidates at 32", async () => {
  let callIndex = 0;
  const deps = createMemoryImportDepsForTest({
    requireAuth: async () => ({ userId: "user_1" }),
    getRequiredUserOpenRouterApiKey: async () => "key",
    extractDocxContent: async () => ({
      text: "",
      markdown: "",
      paragraphs: [],
      wordCount: 0,
    }),
    callOpenRouterNonStreaming: async () => {
      callIndex += 1;
      return {
        content:
          `[{"content":"User topic${callIndex} skill${callIndex} region${callIndex} project${callIndex} hobby${callIndex}","category":"skills"}]`,
        usage: null,
        finishReason: "stop",
        audioBase64: "",
        audioTranscript: "",
        generationId: null,
      };
    },
  });

  const ctx = createMockCtx({
    runQuery: async (ref: unknown) => {
      const refKey = getFunctionName(ref as any);
      if (refKey === checkProStatusRef) {
        return true;
      }
      if (refKey === getUserMemoriesRef) {
        return [];
      }
      throw new Error("unexpected query");
    },
    storage: {
      get: async () => new Blob(["profile"], { type: "text/plain" }),
    },
  });

  const files = Array.from({ length: 40 }, (_, i) => ({
    storageId: `storage_${i + 1}` as any,
    filename: `file_${i + 1}.txt`,
    mimeType: "text/plain",
    textContent: `Profile ${i + 1}`,
  }));

  const result = await extractImportCandidatesHandler(ctx, { files }, deps);

  assert.equal(result.length, 32);
  assert.equal(result[0]?.content, "User topic1 skill1 region1 project1 hobby1.");
  assert.equal(result.at(-1)?.content, "User topic32 skill32 region32 project32 hobby32.");
});
