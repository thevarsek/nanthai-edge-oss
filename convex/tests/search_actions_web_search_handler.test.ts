import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { getFunctionName } from "convex/server";

import { internal } from "../_generated/api";
import { runWebSearch } from "../search/actions_web_search";

const baseArgs = {
  sessionId: "session_1",
  assistantMessageId: "assistant_1",
  jobId: "job_1",
  chatId: "chat_1",
  userMessageId: "user_msg_1",
  userId: "user_1",
  query: "What changed in Swift 6 concurrency?",
  complexity: 1,
  expandMultiModelGroups: false,
  modelId: "openai/gpt-5",
  enabledIntegrations: ["google"],
  subagentsEnabled: true,
} as const;

function createCtx(
  options: {
    cancelOnCheck?: number;
    personaPrompt?: string;
    failGenerationSchedule?: boolean;
  } = {},
) {
  const mutations: Record<string, unknown>[] = [];
  const scheduled: Record<string, unknown>[] = [];
  let cancelChecks = 0;

  return {
    mutations,
    scheduled,
    ctx: {
      runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
        if ("personaId" in args) {
          return options.personaPrompt ? { systemPrompt: options.personaPrompt } : null;
        }
        if ("userId" in args) {
          return "sk-test";
        }
        // isJobCancelled (now an internalQuery)
        if (Object.keys(args).length === 1 && "jobId" in args) {
          cancelChecks += 1;
          return cancelChecks === (options.cancelOnCheck ?? -1);
        }
        return null;
      },
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
        return null;
      },
      scheduler: {
        runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
          if (options.failGenerationSchedule && Array.isArray(args.assistantMessageIds)) {
            throw new Error("scheduler unavailable");
          }
          scheduled.push(args);
          return "sched_1";
        },
      },
    } as any,
  };
}

function jsonResponse(
  status: number,
  payload: unknown,
  headers?: Record<string, string>,
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    headers: {
      get: (name: string) =>
        headers?.[name.toLowerCase()] ?? headers?.[name] ?? null,
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as any;
}

test("runWebSearch reuses cached search context and schedules synthesis only", async (t) => {
  const ctxState = createCtx();
  await (runWebSearch as any)._handler(ctxState.ctx, {
    ...baseArgs,
    cachedSearchContext: {
      searchResults: [{
        query: "swift 6",
        content: "Swift 6 adds strict concurrency diagnostics.",
        citations: ["https://example.com/swift-6"],
        success: true,
      }],
    },
    systemPrompt: "Stay concise.",
  });

  const sessionStatuses = ctxState.mutations
    .filter((entry) => "patch" in entry)
    .map((entry) => (entry.patch as Record<string, unknown>).status);
  assert.deepEqual(sessionStatuses, ["synthesizing", "writing"]);

  const searchPatch = ctxState.mutations.find((entry) => entry.mode === "web");
  assert.deepEqual((searchPatch?.searchContext as any).queries, ["swift 6"]);

  const generation = ctxState.scheduled.find((entry) => Array.isArray(entry.assistantMessageIds));
  assert.equal(generation?.webSearchEnabled, false);
  assert.equal(String((generation?.participants as any[])[0].systemPrompt).includes("https://example.com/swift-6"), true);
});

test("runWebSearch performs direct search, tracks perplexity cost, and schedules generation", async (t) => {
  t.after(() => mock.restoreAll());

  const fetchMock = mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "perplexity/sonar");
    assert.equal(body.messages[1].content, baseArgs.query);
    return jsonResponse(200, {
      id: "perplexity_direct_1",
      choices: [{
        message: {
          content: "Swift 6 adds stricter isolation rules [1]",
          annotations: [{
            type: "url_citation",
            url_citation: {
              url: "https://example.com/swift-6",
              title: "Swift 6",
            },
          }],
        },
      }],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        total_tokens: 18,
        cost: 0.02,
      },
    });
  });

  const ctxState = createCtx();
  await (runWebSearch as any)._handler(ctxState.ctx, {
    ...baseArgs,
    systemPrompt: "Be concise.",
  });

  assert.equal(fetchMock.mock.callCount(), 1);
  const sessionStatuses = ctxState.mutations
    .filter((entry) => "patch" in entry)
    .map((entry) => (entry.patch as Record<string, unknown>).status);
  assert.deepEqual(sessionStatuses, ["searching", "synthesizing", "writing"]);

  const ancillary = ctxState.scheduled.find((entry) => entry.source === "search_perplexity");
  assert.equal(ancillary?.generationId, "perplexity_direct_1");

  const generation = ctxState.scheduled.find((entry) => Array.isArray(entry.assistantMessageIds));
  assert.equal(generation?.searchSessionId, "session_1");
  assert.equal(generation?.webSearchEnabled, false);
  assert.equal(
    String((generation?.participants as any[])[0].systemPrompt).includes("https://example.com/swift-6"),
    true,
  );
});

test("runWebSearch generates queries with persona fallback before searching", async (t) => {
  t.after(() => mock.restoreAll());

  const fetchBodies: any[] = [];
  mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    fetchBodies.push(body);
    if (body.model === baseArgs.modelId) {
      return jsonResponse(200, {
        id: "query_gen_1",
        choices: [{
          message: {
            content: JSON.stringify([
              "swift 6 actor isolation changes",
              "swift 6 strict concurrency migration guide",
              "swift 6 sendable updates",
            ]),
          },
          finish_reason: "stop",
        }],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 10,
          total_tokens: 30,
          cost: 0.01,
        },
      });
    }

    const query = body.messages[1].content;
    return jsonResponse(200, {
      id: `perplexity_${fetchBodies.length}`,
      choices: [{
        message: {
          content: `Result for ${query} [1]`,
          annotations: [{
            type: "url_citation",
            url_citation: {
              url: `https://example.com/${encodeURIComponent(query)}`,
              title: "Source",
            },
          }],
        },
      }],
      usage: {
        prompt_tokens: 9,
        completion_tokens: 4,
        total_tokens: 13,
        cost: 0.02,
      },
    });
  });

  const ctxState = createCtx({ personaPrompt: "Research like a terse iOS staff engineer." });
  await (runWebSearch as any)._handler(ctxState.ctx, {
    ...baseArgs,
    complexity: 2,
    personaId: "persona_1",
  });

  assert.equal(fetchBodies.length, 4);
  assert.equal(fetchBodies[0].messages[0].role, "system");
  assert.equal(fetchBodies[0].messages[0].content, "Research like a terse iOS staff engineer.");

  const sessionStatuses = ctxState.mutations
    .filter((entry) => "patch" in entry)
    .map((entry) => (entry.patch as Record<string, unknown>).status);
  assert.deepEqual(sessionStatuses, ["planning", "searching", "synthesizing", "writing"]);

  const ancillarySources = ctxState.scheduled
    .map((entry) => entry.source)
    .filter(Boolean);
  assert.deepEqual(ancillarySources, [
    "search_query_gen",
    "search_perplexity",
    "search_perplexity",
    "search_perplexity",
  ]);

  const searchPatch = ctxState.mutations.find((entry) => entry.mode === "web");
  assert.deepEqual((searchPatch?.searchContext as any).queries, [
    "swift 6 actor isolation changes",
    "swift 6 strict concurrency migration guide",
    "swift 6 sendable updates",
  ]);
});

test("runWebSearch finalizes cancelled searches before generation handoff", async (t) => {
  t.after(() => mock.restoreAll());

  mock.method(globalThis, "fetch", async () =>
    jsonResponse(200, {
      id: "perplexity_cancelled",
      choices: [{
        message: {
          content: "Swift 6 rollout notes [1]",
          annotations: [{
            type: "url_citation",
            url_citation: {
              url: "https://example.com/swift-rollout",
              title: "Rollout",
            },
          }],
        },
      }],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 5,
        total_tokens: 10,
        cost: 0.01,
      },
    })) as any;

  const ctxState = createCtx({ cancelOnCheck: 1 });
  await (runWebSearch as any)._handler(ctxState.ctx, {
    ...baseArgs,
    complexity: 1,
  });

  const finalizeRef = getFunctionName(internal.chat.mutations.finalizeGeneration);
  const finalizeCall = ctxState.mutations.find(
    (entry) => entry.messageId === baseArgs.assistantMessageId && entry.status === "cancelled",
  );
  assert.equal(finalizeCall?.content, "[Search cancelled]");
  assert.equal(
    ctxState.scheduled.some((entry) => Array.isArray(entry.assistantMessageIds)),
    false,
  );
  assert.equal(finalizeRef.length > 0, true);
  const lastSessionPatch = ctxState.mutations
    .filter((entry) => "patch" in entry)
    .at(-1);
  assert.equal((lastSessionPatch?.patch as any).status, "cancelled");
});

test("runWebSearch finalizes failed sessions when search fails", async (t) => {
  t.after(() => mock.restoreAll());

  mock.method(globalThis, "fetch", async () =>
    jsonResponse(503, { error: { message: "upstream unavailable" } })) as any;

  const ctxState = createCtx({ failGenerationSchedule: true });
  await (runWebSearch as any)._handler(ctxState.ctx, {
    ...baseArgs,
    cachedSearchContext: {
      searchResults: [{
        query: "swift 6",
        content: "cached result",
        citations: ["https://example.com/swift-6"],
        success: true,
      }],
    },
  });

  const finalizeCall = ctxState.mutations.find(
    (entry) => entry.messageId === baseArgs.assistantMessageId && entry.status === "failed",
  );
  assert.match(String(finalizeCall?.content ?? ""), /scheduler unavailable/);

  const lastSessionPatch = ctxState.mutations
    .filter((entry) => "patch" in entry)
    .at(-1);
  assert.equal((lastSessionPatch?.patch as any).status, "failed");
  assert.equal(
    ctxState.scheduled.some((entry) => Array.isArray(entry.assistantMessageIds)),
    false,
  );
});
