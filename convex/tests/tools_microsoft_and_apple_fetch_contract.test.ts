import assert from "node:assert/strict";
import test from "node:test";

import { appleCalendarList } from "../tools/apple/calendar_read";
import { appleCalendarCreate, appleCalendarDelete } from "../tools/apple/calendar_write";
import { fetchImage } from "../tools/fetch_image";
import { msCalendarList } from "../tools/microsoft/calendar";
import { onedriveList, onedriveMove, onedriveRead, onedriveUpload } from "../tools/microsoft/onedrive";
import {
  outlookDelete,
  outlookListFolders,
  outlookMove,
  outlookRead,
  outlookSearch,
  outlookSend,
} from "../tools/microsoft/outlook";

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

function createMicrosoftToolCtx(ctxOverrides: Record<string, unknown> = {}) {
  return {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    jobId: "job_1",
    executionAttemptId: "attempt_1",
    executionFence: 1,
    toolCallId: "tool_call_1",
    ctx: {
      runQuery: async (_reference: unknown, args?: Record<string, unknown>) => {
        if (Array.isArray(args?.storageIds)) {
          const ownedIds = new Set(["image_1", "storage_1", "storage_bad"]);
          return args.storageIds
            .filter((storageId): storageId is string =>
              typeof storageId === "string" && ownedIds.has(storageId)
            )
            .map((storageId) => ({ storageId }));
        }
        return {
          _id: "ms_1",
          userId: "user_1",
          provider: "microsoft",
          accessToken: "ms_token",
          refreshToken: "refresh_1",
          expiresAt: Date.now() + 60 * 60 * 1000,
          scopes: ["Calendars.ReadWrite", "Mail.ReadWrite", "Mail.Send", "Files.ReadWrite"],
          status: "active",
          connectedAt: 1,
        };
      },
      runMutation: async () => undefined,
      runAction: async (_reference: unknown, args: Record<string, unknown>) => ({
        success: true,
        data: {
          imageStorageId: "image_new",
          mimeType: "image/png",
          source: "url",
          originalUrl: args.url,
        },
      }),
      storage: {
        getUrl: async (storageId: string) => {
          if (storageId === "storage_1") return "https://cdn.example/storage_1";
          if (storageId === "storage_bad") return "https://cdn.example/storage_bad";
          return null;
        },
        getMetadata: async (storageId: string) =>
          storageId === "storage_1" || storageId === "storage_bad"
            ? { size: 11 }
            : null,
        get: async (storageId: string) =>
          storageId === "image_1" ? { size: 2048, type: "image/png" } : null,
        store: async () => "image_new",
        delete: async () => undefined,
      },
      ...ctxOverrides,
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

test("microsoft OneDrive tools cover validation, listing, reading, moving, and error branches", async () => {
  const missingUploadArgs = await onedriveUpload.execute(createMicrosoftToolCtx(), {
    storage_id: "",
    filename: "",
  });
  const missingStoredFile = await onedriveUpload.execute(createMicrosoftToolCtx(), {
    storage_id: "missing",
    filename: "Report.txt",
  });
  const missingReadId = await onedriveRead.execute(createMicrosoftToolCtx(), {});
  const missingMoveId = await onedriveMove.execute(createMicrosoftToolCtx(), {
    destination_folder_id: "root",
  });
  const missingMoveDestination = await onedriveMove.execute(createMicrosoftToolCtx(), {
    item_id: "item_1",
  });

  assert.equal(missingUploadArgs.success, false);
  assert.equal(missingStoredFile.success, false);
  assert.equal(missingReadId.success, false);
  assert.equal(missingMoveId.success, false);
  assert.equal(missingMoveDestination.success, false);

  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (url === "https://cdn.example/storage_1") {
      return jsonResponse(200, {});
    }
    if (url === "https://cdn.example/storage_bad") {
      return jsonResponse(503, { error: "cdn down" });
    }
    if (url.includes("/drive/root:/Reports/Report.txt:/content")) {
      return jsonResponse(200, { id: "file_uploaded", name: "Report.txt", size: 512 });
    }
    if (url.includes("/drive/root/search")) {
      return jsonResponse(500, { error: "search failed" });
    }
    if (url.includes("/drive/root:/Documents:/children")) {
      return jsonResponse(200, {
        value: [
          {
            id: "folder_1",
            name: "Reports",
            folder: { childCount: 2 },
            lastModifiedDateTime: "2026-05-01T00:00:00Z",
          },
          {
            id: "file_1",
            name: "notes.txt",
            size: 2048,
            file: { mimeType: "text/plain" },
            webUrl: "https://onedrive/notes",
          },
        ],
        "@odata.nextLink": "next",
      });
    }
    if (url.includes("/drive/items/binary_file?")) {
      return jsonResponse(200, {
        id: "binary_file",
        name: "photo.png",
        size: 5 * 1024 * 1024,
        file: { mimeType: "image/png" },
      });
    }
    if (url.includes("/drive/items/text_file?")) {
      return jsonResponse(200, {
        id: "text_file",
        name: "large.txt",
        size: 200_000,
        file: { mimeType: "application/json" },
      });
    }
    if (url.includes("/drive/items/text_file/content")) {
      return { ok: true, status: 200, text: async () => "x".repeat(100_050) } as any;
    }
    if (url.includes("/drive/items/missing_meta?")) {
      return jsonResponse(404, { error: "missing" });
    }
    if (url.includes("/drive/items/item_root")) {
      return jsonResponse(200, {
        id: "item_root",
        name: "Moved.txt",
        webUrl: "https://onedrive/moved",
        parentReference: { path: "/drive/root:" },
      });
    }
    if (url.includes("/drive/items/item_path")) {
      return jsonResponse(409, { error: "conflict" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const cdnFailure = await onedriveUpload.execute(createMicrosoftToolCtx(), {
      storage_id: "storage_bad",
      filename: "Report.txt",
    });
    const uploaded = await onedriveUpload.execute(createMicrosoftToolCtx(), {
      storage_id: "storage_1",
      filename: "Report.txt",
      folder_path: "/Reports/",
    });
    const searchFailure = await onedriveList.execute(createMicrosoftToolCtx(), {
      query: "budget",
    });
    const listed = await onedriveList.execute(createMicrosoftToolCtx(), {
      folder_path: "/Documents/",
      max_results: 999,
    });
    const metaFailure = await onedriveRead.execute(createMicrosoftToolCtx(), {
      file_id: "missing_meta",
    });
    const binary = await onedriveRead.execute(createMicrosoftToolCtx(), {
      file_id: "binary_file",
    });
    const largeText = await onedriveRead.execute(createMicrosoftToolCtx(), {
      file_id: "text_file",
    });
    const movedRoot = await onedriveMove.execute(createMicrosoftToolCtx(), {
      item_id: "item_root",
      destination_folder_id: "root",
      new_name: "Moved.txt",
    });
    const moveFailure = await onedriveMove.execute(createMicrosoftToolCtx(), {
      item_id: "item_path",
      destination_folder_path: "/Archive/",
    });

    assert.equal(cdnFailure.success, false);
    assert.match(String(cdnFailure.error), /HTTP 503/);
    assert.equal(uploaded.success, true);
    assert.match(String((uploaded.data as any).message), /ID: file_uploaded/);
    assert.equal(searchFailure.success, false);
    assert.equal(listed.success, true);
    assert.equal((listed.data as any).hasMore, true);
    assert.equal((listed.data as any).files[0].isFolder, true);
    assert.equal((listed.data as any).files[1].size, "2.0 KB");
    assert.equal(metaFailure.success, false);
    assert.equal(binary.success, true);
    assert.match(String((binary.data as any).message), /File ID: binary_file/);
    assert.equal(largeText.success, true);
    assert.equal((largeText.data as any).truncated, true);
    assert.equal((largeText.data as any).characterCount, 100_000);
    assert.equal(movedRoot.success, true);
    assert.equal(moveFailure.success, false);
    assert.ok(requests.some((request) => request.url.includes("drive/root:/Documents:/children")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("microsoft Outlook tools cover search, delete, move, folders, and failure branches", async () => {
  const missingSearch = await outlookSearch.execute(createMicrosoftToolCtx(), {});
  const missingDelete = await outlookDelete.execute(createMicrosoftToolCtx(), {});
  const missingMoveIds = await outlookMove.execute(createMicrosoftToolCtx(), {
    destination_folder: "archive",
  });
  const missingMoveDestination = await outlookMove.execute(createMicrosoftToolCtx(), {
    message_ids: ["mail_1"],
  });
  const missingSend = await outlookSend.execute(createMicrosoftToolCtx(), {
    to: "",
    subject: "",
    body: "Body",
  });

  assert.equal(missingSearch.success, false);
  assert.equal(missingDelete.success, false);
  assert.equal(missingMoveIds.success, false);
  assert.equal(missingMoveDestination.success, false);
  assert.equal(missingSend.success, false);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/sendMail")) {
      const body = JSON.parse(String(init?.body));
      if (body.message.subject === "fail") {
        return { ok: false, status: 400, text: async () => "bad mail" } as any;
      }
      assert.equal(body.message.body.contentType, "HTML");
      assert.equal(body.message.ccRecipients.length, 2);
      assert.equal(body.message.bccRecipients.length, 1);
      return { ok: true, status: 202, text: async () => "" } as any;
    }
    if (url.includes("/mailFolders/archive/messages?")) {
      return jsonResponse(200, { value: [] });
    }
    if (url.includes("/mailFolders/inbox/messages?")) {
      return jsonResponse(200, {
        value: [{
          id: "mail_html",
          subject: "",
          bodyPreview: "Preview",
          body: { contentType: "html", content: "<p>Hello <b>team</b></p>" },
          from: {},
          toRecipients: [{ emailAddress: {} }],
          isRead: true,
        }],
      });
    }
    if (url.includes("/mailFolders/bad/messages?")) {
      return jsonResponse(500, { error: "read failed" });
    }
    if (url.includes("/messages?") && (url.includes("$search") || url.includes("%24search"))) {
      if (url.includes("empty")) {
        return jsonResponse(200, { value: [] });
      }
      if (url.includes("fail")) {
        return jsonResponse(503, { error: "search failed" });
      }
      return jsonResponse(200, {
        value: [{
          id: "found_1",
          subject: "",
          from: {},
          toRecipients: [{ emailAddress: { address: "to@example.com" } }],
          isRead: false,
        }],
      });
    }
    if (url.includes("/messages/delete_ok")) {
      return { ok: true, status: 204, text: async () => "" } as any;
    }
    if (url.includes("/messages/delete_fail")) {
      return { ok: false, status: 409, text: async () => "conflict" } as any;
    }
    if (url.includes("/messages/delete_throw")) {
      throw new Error("network down");
    }
    if (url.includes("/messages/move_ok/move")) {
      return jsonResponse(200, { id: "moved_1" });
    }
    if (url.includes("/messages/move_fail/move")) {
      return jsonResponse(400, { error: "bad folder" });
    }
    if (url.includes("/messages/move_throw/move")) {
      throw new Error("move network down");
    }
    if (url.includes("/mailFolders/parent_1/childFolders?")) {
      return jsonResponse(200, {
        value: [{ id: "child_1", displayName: "Child", childFolderCount: 1 }],
      });
    }
    if (url.includes("/mailFolders?$select")) {
      return jsonResponse(500, { error: "folders failed" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    const sent = await outlookSend.execute(createMicrosoftToolCtx(), {
      to: "a@example.com",
      subject: "ok",
      body: "<p>Done</p>",
      is_html: true,
      cc: "c@example.com, d@example.com",
      bcc: "b@example.com",
    });
    const sendFailure = await outlookSend.execute(createMicrosoftToolCtx(), {
      to: "a@example.com",
      subject: "fail",
      body: "Nope",
    });
    const emptyRead = await outlookRead.execute(createMicrosoftToolCtx(), {
      folder: "archive",
    });
    const htmlRead = await outlookRead.execute(createMicrosoftToolCtx(), {
      folder: "inbox",
      include_body: true,
      filter: "isRead eq false",
      max_results: 99,
    });
    const readFailure = await outlookRead.execute(createMicrosoftToolCtx(), {
      folder: "bad",
    });
    const emptySearch = await outlookSearch.execute(createMicrosoftToolCtx(), {
      query: "empty",
    });
    const foundSearch = await outlookSearch.execute(createMicrosoftToolCtx(), {
      query: "budget",
      max_results: 99,
    });
    const searchFailure = await outlookSearch.execute(createMicrosoftToolCtx(), {
      query: "fail",
    });
    const deleteMixed = await outlookDelete.execute(createMicrosoftToolCtx(), {
      message_ids: ["delete_ok", "delete_fail"],
    });
    const deleteAllFailed = await outlookDelete.execute(createMicrosoftToolCtx(), {
      message_ids: ["delete_throw"],
    });
    const moveMixed = await outlookMove.execute(createMicrosoftToolCtx(), {
      message_ids: ["move_ok", "move_fail"],
      destination_folder: "archive",
    });
    const moveAllFailed = await outlookMove.execute(createMicrosoftToolCtx(), {
      message_ids: ["move_throw"],
      destination_folder: "archive",
    });
    const folders = await outlookListFolders.execute(createMicrosoftToolCtx(), {
      parent_folder_id: "parent_1",
    });
    const folderFailure = await outlookListFolders.execute(createMicrosoftToolCtx(), {});

    assert.equal(sent.success, true);
    assert.equal(sendFailure.success, false);
    assert.equal(emptyRead.success, true);
    assert.equal((emptyRead.data as any).resultCount, 0);
    assert.equal(htmlRead.success, true);
    assert.equal((htmlRead.data as any).messages[0].subject, "(no subject)");
    assert.equal((htmlRead.data as any).messages[0].body, "Hello team");
    assert.equal(readFailure.success, false);
    assert.equal(emptySearch.success, true);
    assert.equal(foundSearch.success, true);
    assert.equal((foundSearch.data as any).messages[0].from, "unknown");
    assert.equal(searchFailure.success, false);
    assert.equal(deleteMixed.success, true);
    assert.equal((deleteMixed.data as any).failedCount, 1);
    assert.equal(deleteAllFailed.success, false);
    assert.match(String(deleteAllFailed.error), /All 1 delete/);
    assert.equal(moveMixed.success, true);
    assert.equal((moveMixed.data as any).failedCount, 1);
    assert.equal(moveAllFailed.success, false);
    assert.match(String(moveAllFailed.error), /All 1 move/);
    assert.equal(folders.success, true);
    assert.equal((folders.data as any).folders[0].hasSubfolders, true);
    assert.equal(folderFailure.success, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchImage validates existing storage ids and delegates public URL images", async () => {
  const missing = await fetchImage.execute(createMicrosoftToolCtx(), {});
  const stored = await fetchImage.execute(createMicrosoftToolCtx(), { storageId: "image_1" });
  const fetched = await fetchImage.execute(createMicrosoftToolCtx(), {
    url: "https://example.com/chart.png",
  });
  assert.equal(missing.success, false);
  assert.equal(stored.success, true);
  assert.equal((stored.data as any).imageStorageId, "image_1");
  assert.equal(fetched.success, true);
  assert.equal((fetched.data as any).mimeType, "image/png");
});

test("fetchImage rejects invalid inputs and preserves delegated URL failures", async () => {
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

  const delegatedErrors = [
    "Failed to fetch image: HTTP 404 Not Found",
    "Failed to fetch image: Image too large: 11MB exceeds 10MB limit",
    "Failed to fetch image: Image is empty (0 bytes)",
  ];
  const delegatedCtx = createMicrosoftToolCtx({
    runAction: async () => ({
      success: false,
      data: null,
      error: delegatedErrors.shift(),
    }),
  });
  const notFound = await fetchImage.execute(delegatedCtx, {
    url: "https://example.com/missing.png",
  });
  const oversized = await fetchImage.execute(delegatedCtx, {
    url: "https://example.com/huge.png",
  });
  const empty = await fetchImage.execute(delegatedCtx, {
    url: "https://example.com/empty.png",
  });

  assert.equal(both.success, false);
  assert.equal(badUrl.success, false);
  assert.equal(missingStorage.success, false);
  assert.match(String(notFound.error), /HTTP 404/);
  assert.match(String(oversized.error), /exceeds 10MB limit/);
  assert.match(String(empty.error), /0 bytes/);
});
