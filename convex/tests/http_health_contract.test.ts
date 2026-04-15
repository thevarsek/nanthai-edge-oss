import assert from "node:assert/strict";
import test from "node:test";

import { check } from "../health";
import http from "../http";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId } : null),
  };
}

function getDownloadHandler() {
  return (http as any).exactRoutes.get("/download").get("GET")._handler as (
    ctx: any,
    request: Request,
  ) => Promise<Response>;
}

function getScheduledTriggerHandler() {
  return (http as any).exactRoutes.get("/scheduled-jobs/trigger").get("POST")._handler as (
    ctx: any,
    request: Request,
  ) => Promise<Response>;
}

test("health check reports stable auth state for signed-in and anonymous callers", async () => {
  const authenticated = await (check as any)._handler({
    auth: buildAuth(),
  }, {});
  const anonymous = await (check as any)._handler({
    auth: buildAuth(null),
  }, {});

  assert.deepEqual(authenticated, {
    status: "ok",
    authenticated: true,
    userId: "user_1",
  });
  assert.deepEqual(anonymous, {
    status: "ok",
    authenticated: false,
    userId: null,
  });
});

test("download route validates storageId and missing blobs", async () => {
  const handler = getDownloadHandler();

  const missingParam = await handler(
    { storage: { get: async () => null } },
    new Request("https://example.com/download"),
  );
  const invalidId = await handler(
    { storage: { get: async () => { throw new Error("bad"); } } },
    new Request("https://example.com/download?storageId=storage_1"),
  );
  const notFound = await handler(
    { storage: { get: async () => null } },
    new Request("https://example.com/download?storageId=storage_1"),
  );

  assert.equal(missingParam.status, 400);
  assert.equal(await missingParam.text(), "Missing storageId parameter");
  assert.equal(invalidId.status, 400);
  assert.equal(await invalidId.text(), "Invalid storageId");
  assert.equal(notFound.status, 404);
  assert.equal(await notFound.text(), "File not found");
});

test("download route derives headers from filename and preserves utf8 filename*", async () => {
  const handler = getDownloadHandler();
  const response = await handler(
    {
      storage: {
        get: async () => new Blob(["hello"], { type: "" }),
      },
    },
    new Request("https://example.com/download?storageId=storage_1&filename=na%C3%AFve%20report.md"),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/markdown");
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=3600");
  assert.equal(
    response.headers.get("Content-Disposition"),
    `attachment; filename="na_ve report.md"; filename*=UTF-8''na%C3%AFve%20report.md`,
  );
  assert.equal(await response.text(), "hello");
});

test("download route falls back to blob content type when extension is unknown", async () => {
  const handler = getDownloadHandler();
  const response = await handler(
    {
      storage: {
        get: async () => new Blob(["{}"], { type: "application/custom" }),
      },
    },
    new Request("https://example.com/download?storageId=storage_1&filename=archive.bin"),
  );

  assert.equal(response.headers.get("Content-Type"), "application/custom");
});

test("scheduled trigger route rejects unauthorized callers", async () => {
  const handler = getScheduledTriggerHandler();
  const response = await handler(
    {
      auth: buildAuth(null),
      runQuery: async () => ({ _id: "job_1", userId: "user_1" }),
      runMutation: async () => undefined,
    },
    new Request("https://example.com/scheduled-jobs/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: "job_1" }),
    }),
  );

  assert.equal(response.status, 401);
  const payload = await response.json() as { error: string };
  assert.equal(payload.error, "Unauthorized");
});

test("scheduled trigger route supports idempotent API token execution", async () => {
  const handler = getScheduledTriggerHandler();
  const response = await handler(
    {
      auth: buildAuth(null),
      runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
        if (args.jobId) {
          return { _id: "job_1", userId: "user_1" };
        }
        return { _id: "tok_1", userId: "user_1", jobId: "job_1", status: "active" };
      },
      runMutation: async (_fn: unknown, _args: Record<string, unknown>) => ({
        duplicate: false,
        triggered: true,
        message: "Scheduled job execution triggered.",
      }),
    },
    new Request("https://example.com/scheduled-jobs/trigger", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk_sched_abc123",
        "Idempotency-Key": "idem-1",
      },
      body: JSON.stringify({
        jobId: "job_1",
        variables: { CONTEXT: "alpha" },
      }),
    }),
  );

  assert.equal(response.status, 202);
  const payload = await response.json() as { triggered: boolean; duplicate: boolean };
  assert.equal(payload.triggered, true);
  assert.equal(payload.duplicate, false);
});

test("scheduled trigger route rejects trigger tokens whose user does not match the job owner", async () => {
  const handler = getScheduledTriggerHandler();
  const response = await handler(
    {
      auth: buildAuth(null),
      runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
        if (args.jobId) {
          return { _id: "job_1", userId: "user_job_owner" };
        }
        return { _id: "tok_1", userId: "user_token_owner", jobId: "job_1", status: "active" };
      },
      runMutation: async () => undefined,
    },
    new Request("https://example.com/scheduled-jobs/trigger", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk_sched_abc123",
      },
      body: JSON.stringify({ jobId: "job_1" }),
    }),
  );

  assert.equal(response.status, 401);
  const payload = await response.json() as { error: string };
  assert.equal(payload.error, "Unauthorized");
});

test("scheduled trigger route rate limits bursts for the same job", async () => {
  const handler = getScheduledTriggerHandler();
  let queryCount = 0;
  const response = await handler(
    {
      auth: buildAuth("user_1"),
      runQuery: async () => {
        queryCount += 1;
        if (queryCount === 1) {
          return { _id: "job_1", userId: "user_1" };
        }
        return {
          _id: "inv_1",
          jobId: "job_1",
          status: "triggered",
          createdAt: Date.now(),
        };
      },
      runMutation: async () => undefined,
    },
    new Request("https://example.com/scheduled-jobs/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: "job_1" }),
    }),
  );

  assert.equal(response.status, 429);
  const payload = await response.json() as { error: string };
  assert.equal(payload.error, "Too Many Requests");
});
