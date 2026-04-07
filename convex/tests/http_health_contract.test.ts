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
