import assert from "node:assert/strict";
import test from "node:test";

import {
  extractContentFromNonStreamingPayload,
  processSSEEvent,
} from "../lib/openrouter_sse_event.ts";

test("processSSEEvent preserves paragraph spacing when reasoning_details are provided", () => {
  const result = processSSEEvent({
    data: JSON.stringify({
      choices: [{
        delta: {
          reasoning_details: [
            {
              type: "reasoning.summary",
              summary: "**Verifying Siri information**",
            },
            {
              type: "reasoning.text",
              text: "I should double-check the current status.",
            },
            {
              type: "reasoning.summary",
              summary: "**Searching for confirmation**",
            },
          ],
        },
      }],
    }),
  });

  assert.equal(
    result.reasoningDelta,
    [
      "**Verifying Siri information**",
      "I should double-check the current status.",
      "**Searching for confirmation**",
    ].join("\n\n"),
  );
});

test("processSSEEvent extracts streamed audio payload and transcript deltas", () => {
  const result = processSSEEvent({
    data: JSON.stringify({
      choices: [{
        delta: {
          audio: {
            data: "QUJD",
            transcript: "Hello there",
          },
        },
      }],
    }),
  });

  assert.equal(result.audioDelta, "QUJD");
  assert.equal(result.audioTranscriptDelta, "Hello there");
});

test("processSSEEvent extracts content from response.content_part.delta payload.delta strings", () => {
  const result = processSSEEvent({
    event: "response.content_part.delta",
    data: JSON.stringify({
      type: "response.content_part.delta",
      delta: " continued text",
    }),
  });

  assert.equal(result.contentDelta, " continued text");
});

test("processSSEEvent extracts content from response.output_item.delta nested delta text", () => {
  const result = processSSEEvent({
    event: "response.output_item.delta",
    data: JSON.stringify({
      type: "response.output_item.delta",
      delta: {
        content: [
          {
            type: "output_text",
            text: "\n- next bullet",
          },
        ],
      },
    }),
  });

  assert.equal(result.contentDelta, "\n- next bullet");
});

test("extractContentFromNonStreamingPayload extracts audio payload and transcript", () => {
  const result = extractContentFromNonStreamingPayload({
    choices: [{
      message: {
        content: "Spoken response",
        audio: {
          data: "QUJDRA==",
          transcript: "Spoken response",
        },
      },
      finish_reason: "stop",
    }],
  });

  assert.equal(result.content, "Spoken response");
  assert.equal(result.audioBase64, "QUJDRA==");
  assert.equal(result.audioTranscript, "Spoken response");
  assert.equal(result.finishReason, "stop");
});
