import assert from "node:assert/strict";
import test from "node:test";

import { driveList, driveMove, driveRead, driveUpload } from "../tools/google/drive";
import { gmailCreateDraft, gmailRead, gmailSend } from "../tools/google/gmail";

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
          "https://www.googleapis.com/auth/drive.file",
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
    let listQueryCount = 0;
    const listed = await driveList.execute({
      ...createGoogleToolCtx(),
      ctx: {
        ...createGoogleToolCtx().ctx,
        runQuery: async () => {
          listQueryCount += 1;
          if (listQueryCount === 1) return createGoogleToolCtx().ctx.runQuery();
          return {
            rows: [
              {
                fileId: "drive_1",
                name: "Report.txt",
                mimeType: "text/plain",
                webViewLink: "https://drive.google.com/file/d/drive_1/view",
                grantedAt: 1,
              },
            ],
            totalGrantCount: 1,
            matchedGrantCount: 1,
          };
        },
      },
    } as any, {
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
    assert.equal(listed.success, true);
    assert.equal((listed.data as any).files[0].id, "drive_1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("google drive list defers to picker when a search misses existing grants", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("Unexpected fetch");
  }) as any;

  try {
    let listQueryCount = 0;
    const listed = await driveList.execute({
      ...createGoogleToolCtx(),
      ctx: {
        ...createGoogleToolCtx().ctx,
        runQuery: async () => {
          listQueryCount += 1;
          if (listQueryCount === 1) return createGoogleToolCtx().ctx.runQuery();
          return {
            rows: [],
            totalGrantCount: 1,
            matchedGrantCount: 0,
          };
        },
      },
    } as any, {
      query: "Tenancy Agreement",
      max_results: 10,
    });

    assert.equal(listed.success, true);
    assert.equal((listed.data as any).requiresDrivePicker, true);
    assert.equal((listed.deferred as any).kind, "drive_picker");
    assert.equal((listed.deferred as any).data.reason, "no_matching_drive_file_grants");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("google drive read and move require explicit Drive Picker grants", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("Unexpected fetch before grant check");
  }) as any;

  try {
    const buildCtx = () => {
      let queryCount = 0;
      return {
        toolCtx: {
          ...createGoogleToolCtx(),
          ctx: {
            ...createGoogleToolCtx().ctx,
            runQuery: async () => {
              queryCount += 1;
              if (queryCount === 1) return createGoogleToolCtx().ctx.runQuery();
              return null;
            },
          },
        } as any,
        get queryCount() { return queryCount; },
      };
    };

    const readCtx = buildCtx();
    const moveCtx = buildCtx();
    const read = await driveRead.execute(readCtx.toolCtx, { file_id: "drive_unpicked" });
    const moved = await driveMove.execute(moveCtx.toolCtx, {
      file_id: "drive_unpicked",
      destination_folder_id: "folder_1",
    });

    assert.equal(read.success, false);
    assert.equal((read.data as any).requiresDrivePicker, true);
    assert.equal((read.data as any).fileId, "drive_unpicked");
    assert.equal(moved.success, false);
    assert.equal((moved.data as any).requiresDrivePicker, true);
    assert.equal(moveCtx.queryCount, 2);
    assert.equal(readCtx.queryCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gmail tools require manual Gmail credentials", async () => {
  const ctx = {
    userId: "user_1",
    ctx: {
      runQuery: async () => null,
    },
  } as any;

  const sent = await gmailSend.execute(ctx, {
    to: "alice@example.com",
    subject: "Update",
    body: "<p>Hello</p>",
    is_html: true,
  });
  const read = await gmailRead.execute(ctx, {
    query: "from:boss@example.com",
    include_body: true,
    max_results: 5,
  });
  const draft = await gmailCreateDraft.execute(ctx, {
    to: "alice@example.com",
    subject: "Draft",
    body: "Hello",
  });

  assert.equal(sent.success, false);
  assert.match(String(sent.error), /Manual Gmail connection/);
  assert.equal(read.success, false);
  assert.match(String(read.error), /Manual Gmail connection/);
  assert.equal(draft.success, false);
  assert.match(String(draft.error), /Manual Gmail connection/);
});

// -----------------------------------------------------------------------------
// Schema strictness — protects against Azure GPT-5 strict-mode silent drops.
// All Google Drive tool param schemas MUST set additionalProperties: false and
// use "integer" (not "number") for count-style fields. When this regressed in
// the past, GPT-5.5 on Azure consumed input tokens and emitted 0 output tokens
// (no error) the moment google-drive was loaded.
// -----------------------------------------------------------------------------

test("google drive tool schemas are strict-mode compatible", () => {
  for (const tool of [driveUpload, driveList, driveRead, driveMove]) {
    assert.equal(tool.definition.type, "function");
    if (tool.definition.type !== "function") continue;
    const params = tool.definition.function.parameters as {
      type: string;
      properties: Record<string, { type: string }>;
      additionalProperties?: boolean;
    };
    assert.equal(
      params.additionalProperties,
      false,
      `${tool.name} parameters must set additionalProperties: false ` +
        "(Azure GPT-5 strict mode rejects schemas without it and returns 0 output tokens silently)",
    );
    for (const [propName, propSchema] of Object.entries(params.properties)) {
      assert.notEqual(
        propSchema.type,
        "number",
        `${tool.name}.${propName} uses type:"number" — use type:"integer" for count-style fields ` +
          "(Azure strict mode prefers integer)",
      );
    }
  }
});
