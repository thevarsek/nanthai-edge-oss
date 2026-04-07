import assert from "node:assert/strict";
import test from "node:test";

import { driveList, driveUpload } from "../tools/google/drive";
import { gmailRead, gmailSend } from "../tools/google/gmail";

function jsonResponse(status: number, payload: unknown, headers?: Record<string, string>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    headers: {
      get: (name: string) => headers?.[name.toLowerCase()] ?? headers?.[name] ?? null,
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    blob: async () => new Blob(["file-bytes"], { type: "text/plain" }),
  } as any;
}

function createGoogleToolCtx() {
  return {
    userId: "user_1",
    ctx: {
      runQuery: async () => ({
        _id: "google_1",
        userId: "user_1",
        provider: "google",
        accessToken: "google_token",
        refreshToken: "refresh_1",
        expiresAt: Date.now() + 60 * 60 * 1000,
        scopes: [
          "https://www.googleapis.com/auth/drive",
          "https://www.googleapis.com/auth/gmail.modify",
        ],
        email: "owner@example.com",
        status: "active",
        connectedAt: 1,
      }),
      runMutation: async () => undefined,
      storage: {
        getUrl: async (storageId: string) =>
          storageId === "storage_1" ? "https://cdn.example/storage_1" : null,
      },
    },
  } as any;
}

test("google drive tools upload files and surface upstream failures", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (url === "https://cdn.example/storage_1") {
      return jsonResponse(200, {});
    }
    if (url.includes("/upload/drive/v3/files")) {
      return jsonResponse(200, {
        id: "drive_1",
        name: "Report.txt",
        mimeType: "text/plain",
        webViewLink: "https://drive.google.com/file/d/drive_1/view",
      });
    }
    if (url.includes("/drive/v3/files?")) {
      return jsonResponse(403, { error: "denied" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const uploaded = await driveUpload.execute(createGoogleToolCtx(), {
      storage_id: "storage_1",
      filename: "Report.txt",
    });
    const listed = await driveList.execute(createGoogleToolCtx(), {
      query: "name contains 'report'",
      max_results: 99,
    });

    assert.equal(uploaded.success, true);
    assert.equal((uploaded.data as any).fileId, "drive_1");
    assert.match(String((uploaded.data as any).message), /Open in Drive/);
    assert.equal(
      String((requests[1]!.init?.headers as Record<string, string>)["Content-Type"]).startsWith("multipart/related"),
      true,
    );
    assert.equal(listed.success, false);
    assert.match(String(listed.error), /HTTP 403/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gmail tools send mail and read message bodies with canonical fields", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (url.endsWith("/messages/send")) {
      return jsonResponse(200, { id: "msg_sent_1", threadId: "thread_1", labelIds: [] });
    }
    if (url.includes("/messages/msg_1?")) {
      return jsonResponse(200, {
        id: "msg_1",
        threadId: "thread_1",
        snippet: "Preview text",
        internalDate: "1710000000000",
        payload: {
          headers: [
            { name: "Subject", value: "Hello" },
            { name: "From", value: "boss@example.com" },
            { name: "Date", value: "Tue, 1 Apr 2026 12:00:00 +0000" },
          ],
          body: { data: Buffer.from("Full body").toString("base64url") },
          mimeType: "text/plain",
        },
      });
    }
    if (url.includes("/messages?")) {
      return jsonResponse(200, { messages: [{ id: "msg_1" }] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const sent = await gmailSend.execute(createGoogleToolCtx(), {
      to: "alice@example.com",
      subject: "Update",
      body: "<p>Hello</p>",
      is_html: true,
      cc: "cc@example.com",
    });
    const read = await gmailRead.execute(createGoogleToolCtx(), {
      query: "from:boss@example.com",
      include_body: true,
      max_results: 5,
    });

    assert.equal(sent.success, true);
    assert.equal((sent.data as any).threadId, "thread_1");
    assert.match(String(requests[0]!.init?.body), /raw/);
    assert.equal(read.success, true);
    assert.equal((read.data as any).messages[0].subject, "Hello");
    assert.equal((read.data as any).messages[0].body, "Full body");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
