import assert from "node:assert/strict";
import test from "node:test";

import { getAccountCapabilitiesPublic } from "../capabilities/queries";
import { get as getFolder, list as listFolders } from "../folders/queries";
import { get as getParticipant, listByChat } from "../participants/queries";
import { getDefault, get as getPersona, list as listPersonas } from "../personas/queries";
import { get, getKBFileContents, hasApiKey, list, listRuns } from "../scheduledJobs/queries";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId, email: "user@example.com" } : null),
  };
}

test("persona queries are auth-aware and resolve avatar URLs", async () => {
  const personas = [
    { _id: "persona_2", userId: "user_1", name: "Writer", avatarImageStorageId: "avatar_2", isDefault: true },
    { _id: "persona_1", userId: "user_1", name: "Analyst" },
  ];

  const listResult = await (listPersonas as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          collect: async () => personas,
        }),
      }),
    },
    storage: {
      getUrl: async (id: string) => `https://cdn.example/${id}`,
    },
  }, {});

  const defaultResult = await (getDefault as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => personas[0],
        }),
      }),
    },
    storage: {
      getUrl: async (id: string) => `https://cdn.example/${id}`,
    },
  }, {});

  const anonymous = await (listPersonas as any)._handler({
    auth: buildAuth(null),
    db: {},
  }, {});

  assert.equal(listResult[0]?.avatarImageUrl, "https://cdn.example/avatar_2");
  assert.equal(listResult[1]?.avatarImageUrl, undefined);
  assert.equal(defaultResult?.avatarImageUrl, "https://cdn.example/avatar_2");
  assert.deepEqual(anonymous, []);
});

test("persona get hides foreign records", async () => {
  const result = await (getPersona as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "persona_1", userId: "user_2" }),
    },
    storage: {
      getUrl: async () => null,
    },
  }, {
    personaId: "persona_1",
  });

  assert.equal(result, null);
});

test("participant queries sort by sortOrder and enforce ownership", async () => {
  const listResult = await (listByChat as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) => (id === "chat_1" ? { _id: "chat_1", userId: "user_1" } : null),
      query: () => ({
        withIndex: () => ({
          collect: async () => [
            { _id: "p2", sortOrder: 2 },
            { _id: "p1", sortOrder: 1 },
          ],
        }),
      }),
    },
  }, {
    chatId: "chat_1",
  });

  const foreign = await (getParticipant as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "participant_1", userId: "user_2" }),
    },
  }, {
    participantId: "participant_1",
  });

  assert.deepEqual(listResult.map((row: any) => row._id), ["p1", "p2"]);
  assert.equal(foreign, null);
});

test("folder queries preserve display ordering and ownership", async () => {
  const listResult = await (listFolders as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          collect: async () => [
            { _id: "folder_c", userId: "user_1", sortOrder: 2, createdAt: 1 },
            { _id: "folder_a", userId: "user_1", sortOrder: 1, createdAt: 3 },
            { _id: "folder_b", userId: "user_1", sortOrder: 1, createdAt: 2 },
          ],
        }),
      }),
    },
  }, {});

  const foreign = await (getFolder as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "folder_1", userId: "user_2" }),
    },
  }, {
    folderId: "folder_1",
  });

  assert.deepEqual(listResult.map((row: any) => row._id), ["folder_b", "folder_a", "folder_c"]);
  assert.equal(foreign, null);
});

test("capabilities public query returns computed account capability state", async () => {
  const result = await (getAccountCapabilitiesPublic as any)._handler({
    auth: buildAuth(),
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => (table === "purchaseEntitlements" ? { status: "active" } : null),
          collect: async () =>
            table === "userCapabilities"
              ? [
                  { capability: "sandboxRuntime", status: "active", expiresAt: Date.now() + 1_000 },
                  { capability: "mcpRuntime", status: "active", expiresAt: Date.now() - 1_000 },
                ]
              : [],
        }),
      }),
    },
  }, {});

  const anonymous = await (getAccountCapabilitiesPublic as any)._handler({
    auth: buildAuth(null),
    db: {},
  }, {});

  assert.deepEqual(result, {
    capabilities: ["pro", "sandboxRuntime"],
    hasMcpRuntime: false,
    hasSandboxRuntime: true,
    isPro: true,
  });
  assert.equal(anonymous, null);
});

test("scheduled job queries enforce ownership, clamp limits, and redact secret presence", async () => {
  const listRunsResult = await (listRuns as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "job_1", userId: "user_1" }),
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () => (table === "scheduledJobs" ? [{ _id: "job_1" }] : []),
          unique: async () => (table === "userSecrets" ? { _id: "secret_1", apiKey: "sk-key" } : null),
          order: () => ({
            take: async (limit: number) => {
              assert.equal(limit, 100);
              return [{ _id: "run_1" }, { _id: "run_2" }];
            },
          }),
        }),
      }),
    },
  }, {
    jobId: "job_1",
    limit: 999,
  });

  const hasKey = await (hasApiKey as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => ({ _id: "secret_1" }),
        }),
      }),
    },
  }, {});

  const getResult = await (get as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "job_1", userId: "user_1" }),
    },
  }, {
    jobId: "job_1",
  });

  const listResult = await (list as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          collect: async () => [{ _id: "job_1" }, { _id: "job_2" }],
        }),
      }),
    },
  }, {});

  assert.deepEqual(listRunsResult.map((row: any) => row._id), ["run_1", "run_2"]);
  assert.equal(hasKey, true);
  assert.equal(getResult?._id, "job_1");
  assert.deepEqual(listResult.map((row: any) => row._id), ["job_1", "job_2"]);
});

test("getKBFileContents skips missing and unreadable blobs", async () => {
  const blob = {
    text: async () => "hello world",
  };

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };

  try {
    const result = await (getKBFileContents as any)._handler({
      storage: {
        get: async (storageId: string) => {
          if (storageId === "good") return blob;
          if (storageId === "bad") throw new Error("boom");
          return null;
        },
      },
    }, {
      storageIds: ["good", "missing", "bad"],
    });

    assert.deepEqual(result, [{ storageId: "good", content: "hello world" }]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /bad/);
  } finally {
    console.warn = originalWarn;
  }
});
