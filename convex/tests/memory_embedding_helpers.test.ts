import assert from "node:assert/strict";
import test, { mock } from "node:test";

import {
  computeEmbedding,
  jaccardSimilarity,
} from "../memory/embedding_helpers";

test("computeEmbedding truncates long input and parses usage metadata", async (t) => {
  t.after(() => mock.restoreAll());

  const seenBodies: Record<string, unknown>[] = [];
  mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    seenBodies.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        id: "embed_1",
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 7, total_tokens: 7 },
      }),
      { status: 200 },
    );
  });

  const result = await computeEmbedding("x".repeat(9000), "sk-key");

  assert.equal(String(seenBodies[0]?.input).length, 8000);
  assert.deepEqual(result, {
    embedding: [0.1, 0.2, 0.3],
    usage: { promptTokens: 7, totalTokens: 7 },
    generationId: "embed_1",
  });
});

test("computeEmbedding returns null on failed or malformed embedding responses", async (t) => {
  t.after(() => mock.restoreAll());

  let call = 0;
  mock.method(globalThis, "fetch", async () => {
    call += 1;
    if (call === 1) {
      return new Response("boom", { status: 500 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });

  assert.equal(await computeEmbedding("hello", "sk-key"), null);
  assert.equal(await computeEmbedding("hello", "sk-key"), null);
});

test("jaccardSimilarity handles overlap and empty unions", () => {
  assert.equal(jaccardSimilarity("alpha beta", "alpha gamma"), 1 / 3);
  assert.equal(jaccardSimilarity("", ""), 1);
});

test("absent OR uses platform OpenAI in the same embedding space and identifies platform billing", async (t) => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "platform-test-key";
  t.after(() => { mock.restoreAll(); if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; });
  const vector = Array.from({ length: 1536 }, (_, index) => index / 1536);
  mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    assert.equal(url, "https://api.openai.com/v1/embeddings");
    assert.deepEqual(JSON.parse(String(init?.body)), { model: "text-embedding-3-small", input: "shared memory", dimensions: 1536 });
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer platform-test-key");
    return Response.json({ data: [{ embedding: vector }], usage: { prompt_tokens: 7, total_tokens: 7 } });
  });
  assert.deepEqual(await computeEmbedding("shared memory", null), {
    embedding: vector, usage: { promptTokens: 7, totalTokens: 7, billingOwner: "platform" },
    generationId: undefined, provider: "openai",
  });
});

test("connected OR failures do not spend platform credits", async (t) => {
  t.after(() => mock.restoreAll());
  const urls: string[] = [];
  mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    return new Response("provider unavailable", { status: 429 });
  });
  assert.equal(await computeEmbedding("shared memory", "or-test-key"), null);
  assert.deepEqual(urls, ["https://openrouter.ai/api/v1/embeddings"]);
});

test("platform embeddings preserve ZDR and reject incompatible vectors before storage", async (t) => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousZdr = process.env.OPENAI_EMBEDDING_ZDR_ENABLED;
  process.env.OPENAI_API_KEY = "platform-test-key";
  delete process.env.OPENAI_EMBEDDING_ZDR_ENABLED;
  t.after(() => {
    mock.restoreAll();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
    if (previousZdr === undefined) delete process.env.OPENAI_EMBEDDING_ZDR_ENABLED; else process.env.OPENAI_EMBEDDING_ZDR_ENABLED = previousZdr;
  });
  let calls = 0;
  mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ data: [{ embedding: [0.1, 0.2] }] }); });
  await assert.rejects(computeEmbedding("private", null, { requireZdr: true }), /Zero Data Retention/);
  assert.equal(calls, 0);
  assert.equal(await computeEmbedding("shared memory", null), null);
});
