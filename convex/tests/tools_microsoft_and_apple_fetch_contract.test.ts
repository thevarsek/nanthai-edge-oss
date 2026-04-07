import assert from "node:assert/strict";
import test from "node:test";

import { appleCalendarList } from "../tools/apple/calendar_read";
import { appleCalendarCreate, appleCalendarDelete } from "../tools/apple/calendar_write";
import { fetchImage } from "../tools/fetch_image";
import { msCalendarList } from "../tools/microsoft/calendar";
import { onedriveUpload } from "../tools/microsoft/onedrive";
import { outlookRead, outlookSend } from "../tools/microsoft/outlook";

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    headers: { get: () => null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    blob: async () => new Blob(["file-bytes"], { type: "text/plain" }),
    arrayBuffer: async () => new TextEncoder().encode("image-bytes").buffer,
  } as any;
}

function createMicrosoftToolCtx() {
  return {
    userId: "user_1",
    ctx: {
      runQuery: async () => ({
        _id: "ms_1",
        userId: "user_1",
        provider: "microsoft",
        accessToken: "ms_token",
        refreshToken: "refresh_1",
        expiresAt: Date.now() + 60 * 60 * 1000,
        scopes: ["Calendars.ReadWrite", "Mail.ReadWrite", "Mail.Send", "Files.ReadWrite"],
        status: "active",
        connectedAt: 1,
      }),
      runMutation: async () => undefined,
      storage: {
        getUrl: async (storageId: string) =>
          storageId === "storage_1" ? "https://cdn.example/storage_1" : null,
        get: async (storageId: string) =>
          storageId === "image_1" ? { size: 2048, type: "image/png" } : null,
        store: async () => "image_new",
      },
    },
  } as any;
}

test("microsoft tools list calendar events, upload OneDrive files, and send/read Outlook mail", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (url.includes("/calendarView?")) {
      return jsonResponse(200, {
        value: [{
          id: "evt_1",
          subject: "Planning",
          start: { dateTime: "2026-05-01T09:00:00", timeZone: "UTC" },
          end: { dateTime: "2026-05-01T10:00:00", timeZone: "UTC" },
        }],
      });
    }
    if (url === "https://cdn.example/storage_1") {
      return jsonResponse(200, {});
    }
    if (url.includes("/drive/root:/Report.txt:/content")) {
      return jsonResponse(200, { id: "file_1", name: "Report.txt", webUrl: "https://onedrive/live" });
    }
    if (url.endsWith("/sendMail")) {
      return { ok: true, status: 202, text: async () => "" } as any;
    }
    if (url.includes("/mailFolders/inbox/messages?")) {
      return jsonResponse(200, {
        value: [{
          id: "mail_1",
          subject: "Hello",
          bodyPreview: "Preview",
          body: { content: "<p>Body</p>" },
          from: { emailAddress: { address: "boss@example.com", name: "Boss" } },
          toRecipients: [{ emailAddress: { address: "me@example.com" } }],
          receivedDateTime: "2026-05-01T08:00:00Z",
          isRead: false,
          conversationId: "conv_1",
        }],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const events = await msCalendarList.execute(createMicrosoftToolCtx(), {
      time_min: "2026-05-01T00:00:00Z",
      time_max: "2026-05-02T00:00:00Z",
    });
    const uploaded = await onedriveUpload.execute(createMicrosoftToolCtx(), {
      storage_id: "storage_1",
      filename: "Report.txt",
    });
    const sent = await outlookSend.execute(createMicrosoftToolCtx(), {
      to: "a@example.com,b@example.com",
      subject: "Status",
      body: "Done",
    });
    const read = await outlookRead.execute(createMicrosoftToolCtx(), {
      include_body: true,
    });

    assert.equal(events.success, true);
    assert.equal((events.data as any).events[0].summary, "Planning");
    assert.equal(uploaded.success, true);
    assert.equal((uploaded.data as any).fileId, "file_1");
    assert.equal(sent.success, true);
    assert.equal(read.success, true);
    assert.equal((read.data as any).messages[0].body, "<p>Body</p>");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchImage validates existing storage ids and fetches URL images with inferred mime types", async () => {
  const missing = await fetchImage.execute(createMicrosoftToolCtx(), {});
  const stored = await fetchImage.execute(createMicrosoftToolCtx(), { storageId: "image_1" });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get: (name: string) =>
        name === "content-type" ? "application/octet-stream" : name === "content-length" ? "11" : null,
    },
    arrayBuffer: async () => new TextEncoder().encode("image-bytes").buffer,
  })) as any;

  try {
    const fetched = await fetchImage.execute(createMicrosoftToolCtx(), {
      url: "https://example.com/chart.png",
    });
    assert.equal(missing.success, false);
    assert.equal(stored.success, true);
    assert.equal((stored.data as any).imageStorageId, "image_1");
    assert.equal(fetched.success, true);
    assert.equal((fetched.data as any).mimeType, "image/png");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchImage rejects invalid inputs and oversized or empty URL responses", async () => {
  const both = await fetchImage.execute(createMicrosoftToolCtx(), {
    url: "https://example.com/a.png",
    storageId: "image_1",
  });
  const badUrl = await fetchImage.execute(createMicrosoftToolCtx(), {
    url: "ftp://example.com/a.png",
  });
  const missingStorage = await fetchImage.execute(createMicrosoftToolCtx(), {
    storageId: "missing_image",
  });

  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    if (callCount === 1) {
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: { get: () => null },
      } as any;
    }
    if (callCount === 2) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: {
          get: (name: string) =>
            name === "content-length" ? String(11 * 1024 * 1024) : null,
        },
        arrayBuffer: async () => new ArrayBuffer(0),
      } as any;
    }
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    } as any;
  }) as any;

  try {
    const notFound = await fetchImage.execute(createMicrosoftToolCtx(), {
      url: "https://example.com/missing.png",
    });
    const oversized = await fetchImage.execute(createMicrosoftToolCtx(), {
      url: "https://example.com/huge.png",
    });
    const empty = await fetchImage.execute(createMicrosoftToolCtx(), {
      url: "https://example.com/empty.png",
    });

    assert.equal(both.success, false);
    assert.equal(badUrl.success, false);
    assert.equal(missingStorage.success, false);
    assert.match(String(notFound.error), /HTTP 404/);
    assert.match(String(oversized.error), /exceeds 10MB limit/);
    assert.match(String(empty.error), /0 bytes/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
