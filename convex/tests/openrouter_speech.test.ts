import assert from "node:assert/strict";
import test from "node:test";
import {
  callOpenRouterSpeech,
  resolveSpeechOptions,
  resolveSpeechVoice,
} from "../lib/openrouter_speech";

test("speech transport sends supported provider options to the dedicated API", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody: unknown;
  try {
    globalThis.fetch = (async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 0x01]), {
        status: 200,
        headers: { "X-Generation-Id": "speech_generation_1" },
      });
    }) as typeof fetch;

    const result = await callOpenRouterSpeech("test-key", {
      model: "deepgram/aura-2",
      input: "Hello",
      voice: "aura-2-thalia-en",
      responseFormat: "mp3",
      speed: 1.2,
      provider: {
        options: { openai: { instructions: "Warm and clear" } },
      },
    });

    assert.equal(capturedUrl, "https://openrouter.ai/api/v1/audio/speech");
    assert.deepEqual(capturedBody, {
      model: "deepgram/aura-2",
      input: "Hello",
      voice: "aura-2-thalia-en",
      response_format: "mp3",
      speed: 1.2,
      provider: {
        options: { openai: { instructions: "Warm and clear" } },
      },
    });
    assert.equal(result.audioBase64, "SUQzAQ==");
    assert.equal(result.generationId, "speech_generation_1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("speech transport exposes the generation ID before a post-response cancellation", async () => {
  const originalFetch = globalThis.fetch;
  let cancellationChecks = 0;
  let observedGenerationId: string | undefined;
  try {
    globalThis.fetch = (async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "X-Generation-Id": "speech_generation_cancelled" },
    })) as typeof fetch;

    await assert.rejects(() => callOpenRouterSpeech("test-key", {
      model: "deepgram/aura-2",
      input: "Hello",
      voice: "aura-2-thalia-en",
      responseFormat: "mp3",
    }, {
      isCancelled: async () => {
        cancellationChecks += 1;
        return cancellationChecks > 1;
      },
      onGenerationId: (generationId) => { observedGenerationId = generationId; },
    }), /cancelled/i);

    assert.equal(observedGenerationId, "speech_generation_cancelled");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("speech transport rejects protected routing before provider dispatch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  try {
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response(new Uint8Array([1]), { status: 200 });
    }) as typeof fetch;

    await assert.rejects(
      () => callOpenRouterSpeech("test-key", {
        model: "deepgram/aura-2",
        input: "Hello",
        voice: "aura-2-thalia-en",
        responseFormat: "mp3",
      }, { requireZdr: true }),
      /Speech generation is unavailable when Zero Data Retention/,
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("speech transport always sends the required provider voice ID", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | undefined;
  try {
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(new Uint8Array([1]), { status: 200 });
    }) as typeof fetch;

    await callOpenRouterSpeech("test-key", {
      model: "fish-audio/s2.1-pro",
      input: "Hello",
      voice: "provider-voice-42",
      responseFormat: "mp3",
    });

    assert.equal(capturedBody?.voice, "provider-voice-42");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("speech option resolution applies only capabilities supported by the model", () => {
  assert.deepEqual(resolveSpeechOptions({
    capabilities: {
      supportsSpeed: true,
      speedMin: 0.5,
      speedMax: 2,
      supportsInstructions: false,
      supportsStyle: true,
      styleDegreeMin: 0.01,
      styleDegreeMax: 2,
    },
    defaults: {
      speed: 1.25,
      outputFormat: "pcm",
      instructions: "Ignored for this model",
      style: "cheerful",
      styleDegree: 1.4,
    },
  }), {
    value: {
      responseFormat: "pcm",
      speed: 1.25,
      providerOptions: {
        azure: { style: "cheerful", styledegree: 1.4 },
      },
    },
  });
});

test("speech option resolution omits explicit controls unsupported by the model", () => {
  assert.deepEqual(resolveSpeechOptions({
    capabilities: {
      outputFormats: ["mp3"],
      supportsSpeed: false,
      supportsInstructions: false,
      supportsStyle: false,
    },
    overrides: {
      speed: 1.5,
      outputFormat: "pcm",
      instructions: "Warm and clear",
      style: "cheerful",
      styleDegree: 1.5,
    },
  }), {
    value: { responseFormat: "mp3" },
  });
});

test("speech option resolution falls back from an unknown format", () => {
  assert.deepEqual(resolveSpeechOptions({
    capabilities: {
      outputFormats: ["pcm"],
      supportsSpeed: false,
      supportsInstructions: false,
      supportsStyle: false,
    },
    defaults: { outputFormat: "mp3" },
    overrides: { outputFormat: "wav" },
  }), {
    value: { responseFormat: "pcm" },
  });
});

test("speech option resolution still rejects an invalid supported override", () => {
  assert.deepEqual(resolveSpeechOptions({
    capabilities: {
      supportsSpeed: true,
      speedMin: 0.5,
      speedMax: 2,
      supportsInstructions: false,
      supportsStyle: false,
    },
    overrides: { speed: 3 },
  }), {
    error: "Speech speed must be between 0.5 and 2 for the selected model.",
  });
});

test("speech option resolution treats zero-valued optional controls as omitted", () => {
  assert.deepEqual(resolveSpeechOptions({
    capabilities: {
      supportsSpeed: false,
      supportsInstructions: false,
      supportsStyle: false,
    },
    overrides: {
      speed: 0,
      styleDegree: 0,
    },
  }), {
    value: { responseFormat: "mp3" },
  });
});

test("speech option resolution omits stale defaults after a model switch", () => {
  assert.deepEqual(resolveSpeechOptions({
    capabilities: {
      supportsSpeed: true,
      speedMin: 0.5,
      speedMax: 2,
      supportsInstructions: false,
      supportsStyle: true,
      styleDegreeMin: 0.01,
      styleDegreeMax: 2,
    },
    defaults: { speed: 3, styleDegree: 1.5 },
  }), {
    value: { responseFormat: "mp3" },
  });
});

test("speech voice resolution ignores an unsupported override", () => {
  assert.deepEqual(resolveSpeechVoice({
    requestedVoice: "shimmer",
    preferredVoice: "aura-2-agathe-fr",
    supportedVoices: ["aura-2-thalia-en", "aura-2-agathe-fr"],
  }), {
    voice: "aura-2-agathe-fr",
  });
});

test("speech voice resolution accepts a saved custom ID when no catalogue is published", () => {
  assert.deepEqual(resolveSpeechVoice({
    preferredVoice: "custom-provider-voice-42",
    supportedVoices: [],
  }), {
    voice: "custom-provider-voice-42",
  });
});

test("speech voice resolution requires a custom ID when no catalogue is published", () => {
  assert.deepEqual(resolveSpeechVoice({ supportedVoices: [] }), {
    error: "A provider voice ID is required for the selected speech model.",
  });
});
