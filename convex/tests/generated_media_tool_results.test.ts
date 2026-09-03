import assert from "node:assert/strict";
import test from "node:test";

import {
  extractGeneratedToolMedia,
  mergeRecoveredToolResults,
  recoverGeneratedMediaOperationResults,
} from "../chat/generated_media_tool_results";

test("generated media tool results project image, audio, and video attachments", () => {
  const result = extractGeneratedToolMedia([
    {
      toolCallId: "image_1",
      toolName: "generate_image",
      result: JSON.stringify({
        imageUrls: ["https://files.example/image.png"],
        imageMimeTypes: ["image/png"],
        requestedCount: 1,
        generatedCount: 1,
      }),
    },
    {
      toolCallId: "audio_1",
      toolName: "generate_speech",
      result: JSON.stringify({
        generatedFileId: "file_1",
        audioStorageId: "audio_storage_1",
        audioMimeType: "audio/mpeg",
        audioDurationMs: 900,
        audioTranscript: "Hello",
      }),
    },
    {
      toolCallId: "video_1",
      toolName: "generate_video",
      result: JSON.stringify({
        videoUrl: "https://files.example/video.mp4",
        videoUrls: ["https://files.example/video.mp4"],
      }),
    },
  ] as never);

  assert.deepEqual(result.imageUrls, ["https://files.example/image.png"]);
  assert.deepEqual(result.generatedFileIds, ["file_1"]);
  assert.equal(result.audio?.storageId, "audio_storage_1");
  assert.equal(result.audio?.generatedFileId, "file_1");
  assert.deepEqual(result.videoUrls, ["https://files.example/video.mp4"]);
});

test("successful media operation results replace stale streaming failures", async () => {
  const operationRows = [
    {
      toolCallId: "image_1",
      toolName: "generate_image",
      status: "succeeded",
      updatedAt: 20,
      resultJson: JSON.stringify({
        success: true,
        data: {
          imageUrls: ["https://files.example/recovered.png"],
          imageMimeTypes: ["image/png"],
          requestedCount: 1,
          generatedCount: 1,
        },
      }),
    },
  ];
  const ctx = {
    db: {
      query: () => ({
        withIndex: (_name: string, build: (query: {
          eq: (field: string, value: unknown) => unknown;
        }) => unknown) => {
          const filters: Record<string, unknown> = {};
          const query = {
            eq(field: string, value: unknown) {
              filters[field] = value;
              return query;
            },
          };
          build(query);
          return {
            collect: async () => operationRows.filter((row) =>
              row.status === filters.status
            ),
          };
        },
      }),
    },
  } as never;

  const recovered = await recoverGeneratedMediaOperationResults(
    ctx,
    "run_1" as never,
  );
  const merged = mergeRecoveredToolResults([
    {
      toolCallId: "image_1",
      toolName: "generate_image",
      result: JSON.stringify({ error: "Unknown tool: generate_image" }),
      isError: true,
    },
  ], recovered);

  assert.equal(merged[0]?.isError, undefined);
  assert.deepEqual(
    extractGeneratedToolMedia(merged).imageUrls,
    ["https://files.example/recovered.png"],
  );
});
