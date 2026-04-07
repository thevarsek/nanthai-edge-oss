import assert from "node:assert/strict";
import test from "node:test";

import {
  clampMessageContent,
  dedupeImageCandidates,
  detectStandaloneBase64Image,
  extractInlineImagePayloads,
  hydrateAttachmentsForRequest,
  persistGeneratedImageUrls,
} from "../chat/action_image_helpers";

test("extractInlineImagePayloads strips inline image payloads and keeps cleaned text", () => {
  const input = [
    "Intro",
    "data:image/png;base64,AAAA BBBB",
    "---",
    "data:image/png;base64,CCCC",
    "!",
    "Outro",
  ].join("\n");

  const result = extractInlineImagePayloads(input);

  assert.deepEqual(result.imagePayloads, [
    "data:image/png;base64,AAAABBBB",
    "data:image/png;base64,CCCC",
  ]);
  assert.equal(result.text.includes("data:image"), false);
  assert.equal(result.text.includes("Intro"), true);
  assert.equal(result.text.includes("Outro"), true);
});

test("detectStandaloneBase64Image and dedupeImageCandidates normalize inline images", () => {
  const pngBase64 = "iVBORw0KGgo" + "A".repeat(9000);

  assert.equal(
    detectStandaloneBase64Image(pngBase64),
    `data:image/png;base64,${pngBase64}`,
  );

  const deduped = dedupeImageCandidates([
    "https://example.com/a.png",
    " https://example.com/a.png ",
    `data:image/png;base64,${pngBase64}`,
    pngBase64,
  ]);

  assert.deepEqual(deduped, [
    "https://example.com/a.png",
    `data:image/png;base64,${pngBase64}`,
  ]);
});

test("persistGeneratedImageUrls stores inline payloads, dedupes URLs, and skips oversized images", async () => {
  const storedBlobs: Blob[] = [];

  const result = await persistGeneratedImageUrls(
    {
      storage: {
        store: async (blob: Blob) => {
          storedBlobs.push(blob);
          return `storage_${storedBlobs.length}` as any;
        },
        get: async () => null,
        getUrl: async (storageId: string) => `https://cdn.example/${storageId}.png`,
      },
    } as any,
    [
      "https://example.com/direct.png",
      "data:image/png;base64,AAEC",
      "data:image/png;base64," + "A".repeat(30_000_000),
      "https://example.com/direct.png",
    ],
  );

  assert.equal(storedBlobs.length, 1);
  assert.deepEqual(result, [
    "https://example.com/direct.png",
    "https://cdn.example/storage_1.png",
  ]);
});

test("hydrateAttachmentsForRequest refreshes image URLs and inlines document blobs as data URLs", async () => {
  const result = await hydrateAttachmentsForRequest(
    {
      storage: {
        store: async () => {
          throw new Error("not used");
        },
        get: async (storageId: string) =>
          storageId === "doc_1"
            ? new Blob([new Uint8Array([0, 1, 2])], { type: "application/pdf" })
            : null,
        getUrl: async (storageId: string) =>
          storageId === "img_1" ? "https://cdn.example/img_1.png" : null,
      },
    } as any,
    [
      {
        _id: "msg_1",
        role: "assistant",
        content: "hello",
        attachments: [
          { type: "image", storageId: "img_1", url: "stale" },
          { type: "document", storageId: "doc_1", mimeType: "application/pdf" },
          { type: "document", storageId: "missing_doc", url: "keep-me" },
        ],
      },
    ] as any,
  );

  const attachments = result[0]?.attachments ?? [];
  assert.equal(attachments[0]?.url, "https://cdn.example/img_1.png");
  assert.equal(attachments[1]?.url, "data:application/pdf;base64,AAEC");
  assert.equal(attachments[1]?.sizeBytes, 3);
  assert.equal(attachments[2]?.url, "keep-me");
});

test("clampMessageContent truncates oversized streaming payloads with a suffix", () => {
  const content = "x".repeat(300_050);
  const result = clampMessageContent(content);

  assert.equal(result.endsWith("[Output truncated]"), true);
  assert.ok(result.length < content.length);
});
