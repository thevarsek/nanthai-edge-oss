import test, { mock } from "node:test";
import assert from "node:assert/strict";

import { executePerplexitySearch } from "../search/helpers";

test("executePerplexitySearch rewrites OpenRouter annotations and adds web tools for non-Perplexity models", async (t) => {
  t.after(() => mock.restoreAll());
  const bodies: Array<Record<string, any>> = [];

  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({
      id: "gen_search_1",
      choices: [{
        message: {
          content: "Claim[1] and fallback[3].",
          annotations: [
            {
              type: "url_citation",
              url_citation: { url: "https://source.example/a", title: "Source A" },
            },
            {
              type: "url_citation",
              url_citation: { url: "https://source.example/b" },
            },
            { type: "other" },
          ],
        },
      }],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        total_tokens: 18,
        cost: 0.002,
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const [result] = await executePerplexitySearch(
    ["latest policy"],
    "openai/gpt-4.1",
    "test-key",
    { maxTokens: 1234, requireZdr: true },
  );

  assert.equal(result?.success, true);
  assert.equal(
    result?.content,
    "Claim [1. Source A](https://source.example/a) and fallback[3].",
  );
  assert.deepEqual(result?.citations, ["https://source.example/a", "https://source.example/b"]);
  assert.deepEqual(result?.usage, {
    promptTokens: 11,
    completionTokens: 7,
    totalTokens: 18,
    cost: 0.002,
  });
  assert.equal(result?.generationId, "gen_search_1");
  assert.equal(bodies[0]?.max_tokens, 1234);
  assert.deepEqual(bodies[0]?.provider, { sort: "latency", zdr: true });
  assert.equal(bodies[0]?.tools?.[0]?.type, "openrouter:web_search");
});

test("executePerplexitySearch sends provider latency sorting for native Perplexity calls", async (t) => {
  t.after(() => mock.restoreAll());
  const bodies: Array<Record<string, any>> = [];

  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({
      id: "gen_search_2",
      choices: [{ message: { content: "Native search result.", annotations: [] } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const [result] = await executePerplexitySearch(
    ["latest policy"],
    "perplexity/sonar-pro",
    "test-key",
  );

  assert.equal(result?.success, true);
  assert.deepEqual(bodies[0]?.provider, { sort: "latency" });
  assert.equal(bodies[0]?.tools, undefined);
});

test("executePerplexitySearch retries no-endpoints without soft provider routing but preserves ZDR", async (t) => {
  t.after(() => mock.restoreAll());
  const bodies: Array<Record<string, any>> = [];
  let fetchCount = 0;

  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    fetchCount += 1;
    if (fetchCount === 1) {
      return new Response(
        JSON.stringify({ error: { message: "No endpoints found for request" } }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({
      id: "gen_search_retry",
      choices: [{ message: { content: "Recovered search result.", annotations: [] } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const [result] = await executePerplexitySearch(
    ["latest policy"],
    "perplexity/sonar-pro",
    "test-key",
    { requireZdr: true },
  );

  assert.equal(result?.success, true);
  assert.equal(result?.content, "Recovered search result.");
  assert.deepEqual(bodies[0]?.provider, { sort: "latency", zdr: true });
  assert.deepEqual(bodies[1]?.provider, { zdr: true });
  assert.equal(fetchCount, 2);
});

test("executePerplexitySearch preserves HTTP and network failure context per query", async (t) => {
  t.after(() => mock.restoreAll());
  let call = 0;
  mock.method(globalThis, "fetch", async () => {
    call += 1;
    if (call === 1) {
      return new Response("upstream unavailable", { status: 503 });
    }
    if (call === 2) {
      throw Object.assign(new Error("fetch failed"), { cause: "ECONNRESET" });
    }
    throw "primitive failure";
  });

  const results = await executePerplexitySearch(
    ["first", "second", "third"],
    "perplexity/sonar-pro-search",
    "test-key",
  );

  assert.equal(results[0]?.success, false);
  assert.match(results[0]?.error ?? "", /Perplexity API error \(503\): upstream unavailable/);
  assert.equal(results[1]?.success, false);
  assert.match(results[1]?.error ?? "", /fetch failed.*ECONNRESET/);
  assert.equal(results[2]?.success, false);
  assert.equal(results[2]?.error, "Unknown search error");
});

test("executePerplexitySearch fails closed when ZDR search has no successful route", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () =>
    new Response("No endpoints found matching your data policy", { status: 404 })
  );

  await assert.rejects(
    () => executePerplexitySearch(
      ["first", "second"],
      "perplexity/sonar-pro",
      "test-key",
      { requireZdr: true },
    ),
    (error: any) => {
      assert.equal(error.data?.code, "ZDR_SEARCH_UNAVAILABLE");
      assert.match(error.data?.message ?? "", /Zero Data Retention/);
      assert.equal(error.data?.failures?.length, 2);
      return true;
    },
  );
});
