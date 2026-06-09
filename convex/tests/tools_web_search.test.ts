import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { ConvexError } from "convex/values";

import { webSearch } from "../tools/web_search";

function response(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

test("web_search uses capped OpenRouter web plugin with ZDR and preserves model-facing output", async (t) => {
  t.after(() => mock.restoreAll());
  let requestBody: Record<string, unknown> = {};
  const annotations = Array.from({ length: 10 }, (_, index) => ({
    type: "url_citation" as const,
    url_citation: {
      url: `https://example.com/${index}`,
      title: `Result ${index}`,
      content: "x".repeat(1_200),
    },
  }));

  mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return response({
      id: "gen_web",
      choices: [{
        finish_reason: "stop",
        message: {
          content: `${"A".repeat(4_500)} [1]`,
          annotations,
        },
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
        cost: 0.01,
      },
    });
  }) as any;

  const result = await webSearch.execute(
    {
      ctx: {
        runQuery: async () => "sk-or-test",
      } as any,
      userId: "user_1",
      modelId: "openai/gpt-5.5",
      requireZdr: true,
    },
    { query: "latest convex agent sdk", max_results: 99 },
  );

  assert.equal(result.success, true);
  assert.deepEqual(requestBody.plugins, [{ id: "web", max_results: 10 }]);
  assert.deepEqual(requestBody.provider, { sort: "latency", zdr: true });
  assert.equal("max_tokens" in requestBody, false);

  const schema = (webSearch.definition as unknown as {
    function: {
      parameters: {
        properties: Record<string, Record<string, unknown>>;
      };
    };
  }).function.parameters.properties.max_results;
  assert.equal(schema.maximum, 10);
  assert.equal(schema.default, 5);

  const data = result.data as {
    content: string;
    annotations: Array<{ url_citation: { content?: string } }>;
    citations: string[];
  };
  assert.equal(data.content.length > 4_500, true);
  assert.equal(data.annotations.length, 10);
  assert.equal(data.annotations[0]?.url_citation.content?.length, 1_200);
  assert.equal(data.citations.length, 10);

  const artifact = result.artifactData as {
    content: string;
    annotations: unknown[];
    requireZdr: boolean;
  };
  assert.equal(artifact.content, data.content);
  assert.equal(artifact.annotations.length, 10);
  assert.equal(artifact.requireZdr, true);
});

test("web_search fails closed when OpenRouter rejects the required web plugin", async (t) => {
  t.after(() => mock.restoreAll());
  let fetchCount = 0;
  let requestBody: Record<string, unknown> = {};

  mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
    fetchCount += 1;
    requestBody = JSON.parse(String(init?.body));
    return {
      ok: false,
      status: 400,
      headers: { get: () => null },
      json: async () => ({ error: { message: "Unsupported parameter plugins" } }),
      text: async () => JSON.stringify({ error: { message: "Unsupported parameter plugins" } }),
    } as unknown as Response;
  });

  await assert.rejects(
    () => webSearch.execute(
      {
        ctx: {
          runQuery: async () => "sk-or-test",
        } as any,
        userId: "user_1",
        modelId: "openai/gpt-5.5",
        requireZdr: false,
      },
      { query: "current launch news" },
    ),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      const data = error.data as { code?: string; message?: string };
      assert.equal(data.code, "INTERNAL_ERROR");
      assert.match(data.message ?? "", /Unsupported parameter plugins/);
      return true;
    },
  );

  assert.equal(fetchCount, 1);
  assert.deepEqual(requestBody.plugins, [{ id: "web", max_results: 5 }]);
});
