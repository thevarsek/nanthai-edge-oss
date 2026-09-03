import assert from "node:assert/strict";
import test from "node:test";

import { outlookCreateDraft } from "../tools/microsoft/outlook_draft";

function toolContext(storageId: string, sizeBytes: number, storageUrl: string) {
  return {
    userId: "user_1",
    ctx: {
      runQuery: async (_reference: unknown, args: Record<string, unknown>) => {
        if (Array.isArray(args.storageIds)) {
          return [{
            storageId,
            filename: "generated-image.png",
            mimeType: "image/png",
            sizeBytes,
          }];
        }
        return {
          _id: "connection_1",
          userId: "user_1",
          provider: "microsoft",
          accessToken: "access_token",
          refreshToken: "refresh_token",
          expiresAt: Date.now() + 60 * 60 * 1000,
          scopes: ["Mail.ReadWrite"],
          status: "active",
          connectedAt: 1,
        };
      },
      runMutation: async () => undefined,
      storage: { getUrl: async () => storageUrl },
    },
  } as any;
}

test("Outlook creates a draft and adds a small owned attachment without sending", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.startsWith("data:")) return await originalFetch(input, init);
    if (url === "https://graph.microsoft.com/v1.0/me/messages") {
      return new Response(JSON.stringify({ id: "draft_1", webLink: "https://outlook.office.com/draft/1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/messages/draft_1/attachments")) {
      return new Response(JSON.stringify({ id: "attachment_1" }), { status: 201 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const result = await outlookCreateDraft.execute(
      toolContext("storage_1", 11, "data:image/png;base64,aW1hZ2UtYnl0ZXM="),
      {
        to: "reviewer@example.com",
        subject: "Generated asset",
        body: "Please review the attached image.",
        attachments: [{ storage_id: "storage_1" }],
      },
    );

    assert.equal(result.success, true);
    assert.equal((result.data as any).attachmentCount, 1);
    assert.equal(requests.some(({ url }) => url.endsWith("/sendMail")), false);
    const attachmentRequest = requests.find(({ url }) => url.endsWith("/messages/draft_1/attachments"));
    assert.ok(attachmentRequest);
    const attachment = JSON.parse(String(attachmentRequest.init?.body));
    assert.equal(attachment.name, "generated-image.png");
    assert.equal(attachment.contentType, "image/png");
    assert.equal(attachment.contentBytes, "aW1hZ2UtYnl0ZXM=");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Outlook uses an upload session at the 3 MB attachment boundary", async () => {
  const originalFetch = globalThis.fetch;
  const bytes = new Uint8Array(3 * 1024 * 1024);
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === "https://cdn.example/large.png") return new Response(bytes, { status: 200 });
    if (url === "https://graph.microsoft.com/v1.0/me/messages") {
      return new Response(JSON.stringify({ id: "draft_large" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/messages/draft_large/attachments/createUploadSession")) {
      return new Response(JSON.stringify({
        uploadUrl: "https://outlook.office.com/api/v1.0/AttachmentSessions/session_1?token=opaque",
      }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.startsWith("https://outlook.office.com/api/v1.0/AttachmentSessions/")) {
      return new Response(null, {
        status: 201,
        headers: {
          Location: "https://outlook.office.com/api/v1.0/Messages('draft_large')/Attachments('attachment_1')",
        },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const result = await outlookCreateDraft.execute(
      toolContext("storage_large", bytes.length, "https://cdn.example/large.png"),
      {
        to: "reviewer@example.com",
        subject: "Large asset",
        body: "Please review.",
        attachments: [{ storage_id: "storage_large" }],
      },
    );

    assert.equal(result.success, true);
    const upload = requests.find(({ url }) => url.startsWith("https://outlook.office.com/api/v1.0/AttachmentSessions/"));
    assert.ok(upload);
    assert.equal((upload.init?.headers as Record<string, string>)["Content-Range"], `bytes 0-${bytes.length - 1}/${bytes.length}`);
    assert.equal((upload.init?.headers as Record<string, string>)["Content-Type"], "application/octet-stream");
    assert.equal((upload.init?.headers as Record<string, string>).Authorization, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Outlook validates progress before completing a multi-chunk attachment", async () => {
  const originalFetch = globalThis.fetch;
  const chunkSize = 12 * 320 * 1024;
  const bytes = new Uint8Array(chunkSize + 1);
  const uploadRequests: RequestInit[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://cdn.example/multi.bin") return new Response(bytes, { status: 200 });
    if (url === "https://graph.microsoft.com/v1.0/me/messages") {
      return new Response(JSON.stringify({ id: "draft_multi" }), { status: 201 });
    }
    if (url.endsWith("/messages/draft_multi/attachments/createUploadSession")) {
      return new Response(JSON.stringify({
        uploadUrl: "https://outlook.office.com/api/v1.0/AttachmentSessions/session_multi",
      }), { status: 201 });
    }
    if (url.endsWith("/AttachmentSessions/session_multi")) {
      uploadRequests.push(init ?? {});
      if (uploadRequests.length === 1) {
        return new Response(JSON.stringify({ nextExpectedRanges: [`${chunkSize}`] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, {
        status: 201,
        headers: {
          Location: "https://outlook.office.com/api/v1.0/Messages('draft_multi')/Attachments('attachment_multi')",
        },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const result = await outlookCreateDraft.execute(
      toolContext("storage_multi", bytes.length, "https://cdn.example/multi.bin"),
      {
        to: "reviewer@example.com",
        subject: "Multi-part asset",
        body: "Please review.",
        attachments: [{ storage_id: "storage_multi" }],
      },
    );

    assert.equal(result.success, true);
    assert.equal(uploadRequests.length, 2);
    assert.equal(
      (uploadRequests[1]?.headers as Record<string, string>)["Content-Range"],
      `bytes ${chunkSize}-${chunkSize}/${bytes.length}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Outlook reports attachments already added when a later attachment fails", async () => {
  const originalFetch = globalThis.fetch;
  let attachmentRequestCount = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("data:")) return await originalFetch(input, init);
    if (url === "https://graph.microsoft.com/v1.0/me/messages") {
      return new Response(JSON.stringify({ id: "draft_partial" }), { status: 201 });
    }
    if (url.endsWith("/messages/draft_partial/attachments")) {
      attachmentRequestCount += 1;
      return new Response(
        attachmentRequestCount === 1 ? JSON.stringify({ id: "attachment_1" }) : null,
        { status: attachmentRequestCount === 1 ? 201 : 500 },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  const context = {
    userId: "user_1",
    ctx: {
      runQuery: async (_reference: unknown, args: Record<string, unknown>) => {
        if (Array.isArray(args.storageIds)) {
          return [
            { storageId: "storage_1", filename: "first.png", mimeType: "image/png", sizeBytes: 3 },
            { storageId: "storage_2", filename: "second.png", mimeType: "image/png", sizeBytes: 3 },
          ];
        }
        return {
          accessToken: "access_token",
          refreshToken: "refresh_token",
          expiresAt: Date.now() + 60 * 60 * 1000,
          scopes: ["Mail.ReadWrite"],
          status: "active",
        };
      },
      runMutation: async () => undefined,
      storage: {
        getUrl: async (storageId: string) => storageId === "storage_1"
          ? "data:image/png;base64,b25l"
          : "data:image/png;base64,dHdv",
      },
    },
  } as any;

  try {
    const result = await outlookCreateDraft.execute(context, {
      to: "reviewer@example.com",
      subject: "Partial attachments",
      body: "Please review.",
      attachments: [{ storage_id: "storage_1" }, { storage_id: "storage_2" }],
    });

    assert.equal(result.success, false);
    assert.equal((result.data as any).draftCreated, true);
    assert.equal((result.data as any).attachmentCount, 1);
    assert.equal((result.data as any).failedAttachment, "second.png");
    assert.match(result.error ?? "", /Draft was created with 1 attachment/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
