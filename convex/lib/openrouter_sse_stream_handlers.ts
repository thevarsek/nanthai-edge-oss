import { StreamResult } from "./openrouter_types";
import { applySSEEventResult } from "./openrouter_sse_apply";
import { parseSSELines, processSSEEvent } from "./openrouter_sse_event";
import {
  SSEAccumulator,
  SSECallbacks,
  SSEEvent,
} from "./openrouter_sse_types";

function initialAccumulator(): SSEAccumulator {
  return {
    content: "",
    reasoning: "",
    usage: null,
    finishReason: null,
    imageUrls: [],
    audioChunks: [],
    audioTranscript: "",
    toolCallsInProgress: new Map(),
    toolCalls: [],
    annotations: [],
    generationId: null,
  };
}

function accumulatorToResult(state: SSEAccumulator): StreamResult {
  return {
    content: state.content,
    reasoning: state.reasoning,
    usage: state.usage,
    finishReason: state.finishReason,
    imageUrls: state.imageUrls,
    audioBase64: state.audioChunks.join(""),
    audioTranscript: state.audioTranscript,
    toolCalls: state.toolCalls,
    annotations: state.annotations,
    generationId: state.generationId,
  };
}

export async function processSSEBodyStream(
  body: ReadableStream<Uint8Array>,
  callbacks: SSECallbacks,
  onActivity?: () => void,
): Promise<StreamResult> {
  const state = initialAccumulator();

  const reader = body.getReader();
  const decoder = new TextDecoder();

  let lineBuffer = "";
  let currentEvent: string | undefined;
  let dataLines: string[] = [];

  const flushPendingEvent = async (): Promise<boolean> => {
    if (dataLines.length === 0) {
      currentEvent = undefined;
      return false;
    }

    const event: SSEEvent = {
      event: currentEvent,
      data: dataLines.join("\n"),
    };
    currentEvent = undefined;
    dataLines = [];

    const parsed = processSSEEvent(event);
    return await applySSEEventResult(parsed, state, callbacks);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onActivity?.();

      lineBuffer += decoder.decode(value, { stream: true });

      let newlineIndex = lineBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        let line = lineBuffer.slice(0, newlineIndex);
        lineBuffer = lineBuffer.slice(newlineIndex + 1);

        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }

        if (line === "") {
          const doneEvent = await flushPendingEvent();
          if (doneEvent) {
            await reader.cancel();
            return accumulatorToResult(state);
          }
          newlineIndex = lineBuffer.indexOf("\n");
          continue;
        }

        if (line.startsWith(":")) {
          newlineIndex = lineBuffer.indexOf("\n");
          continue;
        }

        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }

        newlineIndex = lineBuffer.indexOf("\n");
      }
    }

    lineBuffer += decoder.decode();

    if (lineBuffer.length > 0) {
      let trailing = lineBuffer;
      if (trailing.endsWith("\r")) {
        trailing = trailing.slice(0, -1);
      }
      if (trailing.startsWith("event:")) {
        currentEvent = trailing.slice(6).trim();
      } else if (trailing.startsWith("data:")) {
        dataLines.push(trailing.slice(5).trim());
      }
    }

    await flushPendingEvent();
  } finally {
    reader.releaseLock();
  }

  return accumulatorToResult(state);
}

export async function processSSETextStream(
  sseText: string,
  callbacks: SSECallbacks,
): Promise<StreamResult> {
  const state = initialAccumulator();

  for (const event of parseSSELines(sseText)) {
    if (event.data === "[DONE]") break;
    await applySSEEventResult(processSSEEvent(event), state, callbacks);
  }

  return accumulatorToResult(state);
}
