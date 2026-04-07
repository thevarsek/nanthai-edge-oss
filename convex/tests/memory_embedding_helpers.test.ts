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
