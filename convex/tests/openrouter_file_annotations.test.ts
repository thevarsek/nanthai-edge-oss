import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";

import {
  callOpenRouterNonStreaming,
  createOpenRouterNonStreamingDepsForTest,
} from "../lib/openrouter_nonstream";

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("non-streaming responses expose file annotations alongside URL citations", async () => {
  const deps = createOpenRouterNonStreamingDepsForTest({
    fetch: async () => jsonResponse(200, {
      id: "gen_success",
      model: "effective/pdf-model",
      choices: [{
        message: {
          content: "answer [1]",
          annotations: [
            {
              type: "url_citation",
              url_citation: { url: "https://example.com", title: "Example" },
            },
            {
              type: "file",
              file: {
                hash: "pdf_hash",
                name: "scan.pdf",
                content: [
                  { type: "text", text: "Page one" },
                  {
                    type: "image_url",
                    image_url: { url: "data:image/png;base64,aGVsbG8=" },
                  },
                ],
              },
            },
          ],
        },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    }),
  });

  const result = await callOpenRouterNonStreaming(
    "key",
    "openai/gpt-4.1-mini",
    [{ role: "user", content: "read this" }],
    {},
    {},
    deps,
  );

  assert.equal(result.annotations[0]?.url_citation.url, "https://example.com");
  assert.equal(result.modelId, "effective/pdf-model");
  assert.deepEqual(result.fileAnnotations, [{
    type: "file",
    file: {
      hash: "pdf_hash",
      name: "scan.pdf",
      content: [
        { type: "text", text: "Page one" },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,aGVsbG8=" },
        },
      ],
    },
  }]);
});

test("file annotations are strongly validated and deduplicated by hash", async () => {
  const valid = {
    type: "file",
    file: { hash: "same_hash", content: [{ type: "text", text: "first" }] },
  };
  const deps = createOpenRouterNonStreamingDepsForTest({
    fetch: async () => jsonResponse(200, {
      choices: [{
        message: {
          content: "done",
          annotations: [
            valid,
            {
              type: "file",
              file: { hash: "same_hash", content: [{ type: "text", text: "duplicate" }] },
            },
            { type: "file", file: { hash: "missing_content" } },
            {
              type: "file",
              file: { hash: "bad_block", content: [{ type: "text", text: 7 }] },
            },
            { type: "file", file: { hash: "", content: [] } },
          ],
        },
      }],
    }),
  });

  const result = await callOpenRouterNonStreaming(
    "key",
    "openai/gpt-4.1-mini",
    [{ role: "user", content: "read this" }],
    {},
    {},
    deps,
  );

  assert.deepEqual(result.fileAnnotations, [valid]);
});

test("opt-in error recovery returns parsed file annotations before retries or fallback", async () => {
  let fetchCount = 0;
  const deps = createOpenRouterNonStreamingDepsForTest({
    fetch: async () => {
      fetchCount += 1;
      return jsonResponse(400, {
        id: "gen_parse_complete",
        model: "effective/pdf-model",
        error: {
          message: "Unsupported parameter plugins",
          metadata: {
            file_annotations: [{
              type: "file",
              file: {
                hash: "recovered_hash",
                content: [{ type: "text", text: "Recovered OCR text" }],
              },
            }],
          },
        },
        usage: {
          prompt_tokens: 10,
          completion_tokens: 0,
          total_tokens: 10,
          cost: 0.002,
        },
      });
    },
  });

  const result = await callOpenRouterNonStreaming(
    "key",
    "openai/gpt-4.1-mini",
    [{ role: "user", content: "read this" }],
    { plugins: [{ id: "file-parser" }] },
    {
      fallbackModel: "openai/gpt-4.1",
      recoverFileAnnotationsOnError: true,
    },
    deps,
  );

  assert.equal(fetchCount, 1);
  assert.equal(result.content, "");
  assert.equal(result.modelId, "effective/pdf-model");
  assert.equal(result.generationId, "gen_parse_complete");
  assert.equal(result.usage?.cost, 0.002);
  assert.equal(result.fileAnnotations?.[0]?.file.content[0]?.type, "text");
});

test("file-annotation recovery never strips the file-parser plugin", async () => {
  let fetchCount = 0;
  const deps = createOpenRouterNonStreamingDepsForTest({
    fetch: async () => {
      fetchCount += 1;
      if (fetchCount > 1) {
        return jsonResponse(200, {
          choices: [{ message: { content: "plugin was stripped" } }],
        });
      }
      return jsonResponse(400, {
        error: {
          message: "Unsupported parameter plugins",
          metadata: { file_annotations: [{ type: "file", file: {} }] },
        },
      });
    },
  });

  await assert.rejects(
    () => callOpenRouterNonStreaming(
      "key",
      "openai/gpt-4.1-mini",
      [{ role: "user", content: "read this" }],
      { plugins: [{ id: "file-parser" }] },
      { recoverFileAnnotationsOnError: true },
      deps,
    ),
    (error: unknown) => error instanceof ConvexError,
  );
  assert.equal(fetchCount, 1);
});

test("file-annotation error recovery remains disabled by default", async () => {
  const deps = createOpenRouterNonStreamingDepsForTest({
    fetch: async () => jsonResponse(502, {
      error: {
        message: "Provider returned an error",
        metadata: {
          file_annotations: [{
            type: "file",
            file: {
              hash: "parsed_but_failed",
              content: [{ type: "text", text: "Parsed text" }],
            },
          }],
        },
      },
    }),
  });

  await assert.rejects(
    () => callOpenRouterNonStreaming(
      "key",
      "openai/gpt-4.1-mini",
      [{ role: "user", content: "read this" }],
      {},
      {},
      deps,
    ),
    (error: unknown) => error instanceof ConvexError,
  );
});
