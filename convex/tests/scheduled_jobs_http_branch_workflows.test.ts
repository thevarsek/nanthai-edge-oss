import assert from "node:assert/strict";
import test from "node:test";

import http from "../http";

function getScheduledTriggerHandler() {
  return (http as any).exactRoutes.get("/scheduled-jobs/trigger").get("POST")._handler as (
    ctx: any,
    request: Request,
  ) => Promise<Response>;
}

function request(body: string, headers: Record<string, string> = {}) {
  return new Request("https://example.com/scheduled-jobs/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

test("scheduled trigger route rejects malformed JSON and missing job ids", async () => {
  const handler = getScheduledTriggerHandler();
  const ctx = {
    auth: { getUserIdentity: async () => null },
    runQuery: async () => null,
    runMutation: async () => undefined,
  };

  const invalidJson = await handler(ctx, request("{"));
  const missingJobId = await handler(ctx, request(JSON.stringify({ variables: {} })));

  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json() as { error: string }).error, "Invalid JSON body");
  assert.equal(missingJobId.status, 400);
  assert.equal((await missingJobId.json() as { error: string }).error, "Missing required field: jobId");
});

test("scheduled trigger route reports missing jobs before authorization checks", async () => {
  const response = await getScheduledTriggerHandler()({
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    runQuery: async () => null,
    runMutation: async () => undefined,
  }, request(JSON.stringify({ jobId: "job_missing" })));

  assert.equal(response.status, 404);
  assert.equal((await response.json() as { error: string }).error, "Scheduled job not found");
});

test("scheduled trigger route rejects trigger tokens bound to another job", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  let queryCount = 0;
  const response = await getScheduledTriggerHandler()({
    auth: { getUserIdentity: async () => null },
    runQuery: async () => {
      queryCount += 1;
      if (queryCount === 1) return { _id: "job_1", userId: "user_1" };
      return { _id: "token_1", jobId: "job_2", userId: "user_1" };
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
    },
  }, request(JSON.stringify({ jobId: "job_1" }), {
    Authorization: "Bearer sk_sched_other",
  }));

  assert.equal(response.status, 401);
  assert.equal(mutations[0]?.status, "unauthorized");
  assert.match(String(mutations[0]?.note), /mismatched trigger token/);
});

test("scheduled trigger route normalizes variables and returns duplicate API results as ok", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  let queryCount = 0;
  const response = await getScheduledTriggerHandler()({
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    runQuery: async () => {
      queryCount += 1;
      if (queryCount === 1) return { _id: "job_1", userId: "user_1" };
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      return { duplicate: true, triggered: false, message: "Duplicate trigger ignored." };
    },
  }, request(JSON.stringify({
    jobId: "job_1",
    variables: {
      "": "ignored",
      topic: "billing",
      retry: 2,
      dryRun: false,
      empty: null,
      nested: { region: "us" },
      list: ["a", "b"],
    },
  }), { "Idempotency-Key": "idem-1" }));

  const payload = await response.json() as { duplicate: boolean };
  assert.equal(response.status, 200);
  assert.equal(payload.duplicate, true);
  assert.deepEqual(mutations[0]?.variables, {
    topic: "billing",
    retry: "2",
    dryRun: "false",
    empty: "null",
    nested: "{\"region\":\"us\"}",
    list: "[\"a\",\"b\"]",
  });
});

test("scheduled trigger route logs API trigger failures with request context", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  let mutationCount = 0;
  let queryCount = 0;
  const response = await getScheduledTriggerHandler()({
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    runQuery: async () => {
      queryCount += 1;
      return queryCount === 1 ? { _id: "job_1", userId: "user_1" } : null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      mutationCount += 1;
      if (mutationCount === 1) throw new Error("queue unavailable");
    },
  }, request(JSON.stringify({ jobId: "job_1", variables: [] })));

  assert.equal(response.status, 500);
  assert.equal((await response.json() as { error: string }).error, "Failed to trigger scheduled job");
  assert.equal(mutations[1]?.status, "error");
  assert.equal(mutations[1]?.variables, undefined);
  assert.match(String(mutations[1]?.note), /queue unavailable/);
});
