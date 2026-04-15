import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  createJobTriggerToken,
  createJob,
  deleteApiKey,
  deleteJob,
  pauseJob,
  revokeJobTriggerToken,
  rotateJobTriggerToken,
  resumeJob,
  runJobNow,
  triggerJobViaApi,
  updateJob,
  updateJobInternal,
  upsertApiKey,
} from "../scheduledJobs/mutations";
import { listJobTriggerTokens } from "../scheduledJobs/queries";
import { fetchOpenRouterCredits } from "../scheduledJobs/actions";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId } : null),
  };
}

test("createJob stores normalized first step, strips integrations, and schedules first run", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const scheduled: Array<{ when: number; payload: Record<string, unknown> }> = [];

  const result = await (createJob as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => null,
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => {
            if (table === "purchaseEntitlements") return { _id: "ent_1", status: "active" };
            if (table === "cachedModels") return { _id: "model_1", supportsTools: false };
            return null;
          },
        }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "job_1";
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
    scheduler: {
      runAt: async (when: number, _ref: unknown, payload: Record<string, unknown>) => {
        scheduled.push({ when, payload });
        return "sched_1";
      },
    },
  }, {
    name: "  Daily Digest  ",
    prompt: "Summarize today",
    modelId: "openai/gpt-5.2",
    enabledIntegrations: ["gmail"],
    recurrence: { type: "interval", minutes: 15 },
  });

  assert.equal(result, "job_1");
  assert.equal(inserts[0]?.table, "scheduledJobs");
  assert.equal(inserts[0]?.value.name, "Daily Digest");
  assert.deepEqual(inserts[0]?.value.enabledIntegrations, []);
  assert.deepEqual((inserts[0]?.value.steps as Array<any>)[0]?.enabledIntegrations, []);
  assert.equal(scheduled.length, 1);
  assert.deepEqual(scheduled[0]?.payload, { jobId: "job_1" });
  assert.deepEqual(patches[0], {
    id: "job_1",
    value: { scheduledFunctionId: "sched_1" },
  });
});

test("updateJob reschedules on timezone-only change and clears explicit null persona", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const cancelled: string[] = [];
  const scheduled: Array<{ payload: Record<string, unknown> }> = [];

  await (updateJob as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) => {
        if (id === "job_1") {
          return {
            _id: "job_1",
            userId: "user_1",
            prompt: "Digest",
            modelId: "openai/gpt-5.2",
            personaId: "persona_old",
            enabledIntegrations: ["gmail"],
            recurrence: { type: "interval", minutes: 15 },
            timezone: "UTC",
            status: "active",
            scheduledFunctionId: "sched_old",
            steps: [{ prompt: "Digest", modelId: "openai/gpt-5.2", enabledIntegrations: ["gmail"] }],
          };
        }
        return null;
      },
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => {
            if (table === "purchaseEntitlements") return { _id: "ent_1", status: "active" };
            if (table === "cachedModels") return { _id: "model_1", supportsTools: false };
            return null;
          },
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
    scheduler: {
      cancel: async (id: string) => {
        cancelled.push(id);
      },
      runAt: async (_when: number, _ref: unknown, payload: Record<string, unknown>) => {
        scheduled.push({ payload });
        return "sched_new";
      },
    },
  }, {
    jobId: "job_1",
    timezone: "Europe/London",
    personaId: null,
    enabledIntegrations: ["gmail"],
  });

  assert.deepEqual(cancelled, ["sched_old"]);
  assert.equal(scheduled.length, 1);
  assert.equal(patches[0]?.id, "job_1");
  assert.equal(patches[0]?.value.personaId, undefined);
  assert.deepEqual(patches[0]?.value.enabledIntegrations, []);
  assert.equal(patches[0]?.value.scheduledFunctionId, "sched_new");
});

test("updateJobInternal clears persona when personaId is explicitly null", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];

  await (updateJobInternal as any)._handler({
    db: {
      get: async (id: string) => {
        if (id === "job_1") {
          return {
            _id: "job_1",
            userId: "user_1",
            prompt: "Digest",
            modelId: "openai/gpt-5.2",
            personaId: "persona_old",
            enabledIntegrations: [],
            recurrence: { type: "interval", minutes: 15 },
            timezone: "UTC",
            status: "active",
            steps: [{ prompt: "Digest", modelId: "openai/gpt-5.2", personaId: "persona_old" }],
          };
        }
        return null;
      },
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => {
            if (table === "cachedModels") return { _id: "model_1", supportsTools: false };
            return null;
          },
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
    scheduler: {},
  }, {
    jobId: "job_1",
    userId: "user_1",
    personaId: null,
  });

  assert.equal(patches[0]?.id, "job_1");
  assert.equal(patches[0]?.value.personaId, undefined);
  assert.equal((patches[0]?.value.steps as Array<any>)[0]?.personaId, undefined);
});

test("pauseJob and resumeJob transition status and scheduled function state", async () => {
  const pausedPatches: Array<Record<string, unknown>> = [];
  const resumedPatches: Array<Record<string, unknown>> = [];
  const cancelled: string[] = [];
  const scheduled: Array<Record<string, unknown>> = [];

  await (pauseJob as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "job_1", userId: "user_1", status: "active", scheduledFunctionId: "sched_1" }),
      query: () => ({
        withIndex: () => ({
          first: async () => ({ _id: "ent_1", status: "active" }),
        }),
      }),
      patch: async (_id: string, value: Record<string, unknown>) => {
        pausedPatches.push(value);
      },
    },
    scheduler: {
      cancel: async (id: string) => {
        cancelled.push(id);
      },
    },
  }, { jobId: "job_1" });

  await (resumeJob as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({
        _id: "job_1",
        userId: "user_1",
        status: "paused",
        recurrence: { type: "interval", minutes: 15 },
        timezone: "UTC",
      }),
      query: () => ({
        withIndex: () => ({
          first: async () => ({ _id: "ent_1", status: "active" }),
        }),
      }),
      patch: async (_id: string, value: Record<string, unknown>) => {
        resumedPatches.push(value);
      },
    },
    scheduler: {
      runAt: async (_when: number, _ref: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
        return "sched_2";
      },
    },
  }, { jobId: "job_1" });

  assert.deepEqual(cancelled, ["sched_1"]);
  assert.equal(pausedPatches[0]?.status, "paused");
  assert.equal(pausedPatches[0]?.scheduledFunctionId, undefined);
  assert.equal(resumedPatches[0]?.status, "active");
  assert.equal(resumedPatches[0]?.consecutiveFailures, 0);
  assert.equal(resumedPatches[0]?.scheduledFunctionId, "sched_2");
  assert.deepEqual(scheduled, [{ jobId: "job_1" }]);
});

test("deleteJob removes run history in batches and deletes the job", async () => {
  const deleted: string[] = [];
  const cancelled: string[] = [];
  let takeCount = 0;

  await (deleteJob as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "job_1", userId: "user_1", scheduledFunctionId: "sched_1" }),
      query: (table: string) => ({
        withIndex: () => ({
          take: async (_limit: number) => {
            assert.equal(table, "jobRuns");
            takeCount += 1;
            return takeCount === 1
              ? Array.from({ length: 100 }, (_, index) => ({ _id: `run_${index}` }))
              : [{ _id: "run_tail" }];
          },
          first: async () => ({ _id: "ent_1", status: "active" }),
        }),
      }),
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
    scheduler: {
      cancel: async (id: string) => {
        cancelled.push(id);
      },
    },
  }, { jobId: "job_1" });

  assert.deepEqual(cancelled, ["sched_1"]);
  assert.equal(deleted.length, 102);
  assert.equal(deleted[deleted.length - 1], "job_1");
});

test("runJobNow rejects paused manual jobs and schedules active jobs immediately", async () => {
  await assert.rejects(
    (runJobNow as any)._handler({
      auth: buildAuth(),
      db: {
        get: async () => ({
          _id: "job_1",
          userId: "user_1",
          status: "paused",
          recurrence: { type: "manual" },
        }),
        query: () => ({
          withIndex: () => ({
            first: async () => ({ _id: "ent_1", status: "active" }),
          }),
        }),
      },
      scheduler: {},
    }, { jobId: "job_1" }),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      return (error as ConvexError<any>).data?.code === "VALIDATION";
    },
  );

  const scheduled: Array<Record<string, unknown>> = [];
  const result = await (runJobNow as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({
        _id: "job_2",
        userId: "user_1",
        status: "active",
        recurrence: { type: "interval", minutes: 15 },
      }),
      query: () => ({
        withIndex: () => ({
          first: async () => ({ _id: "ent_1", status: "active" }),
        }),
      }),
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
        return "sched_now";
      },
    },
  }, { jobId: "job_2" });

  assert.deepEqual(result, { triggered: true, message: "Job execution started" });
  assert.deepEqual(scheduled, [{ jobId: "job_2", invocationSource: "manual" }]);
});

test("upsertApiKey patches existing secret and deleteApiKey removes it when present", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const deleted: string[] = [];

  await (upsertApiKey as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => ({ _id: "secret_1", userId: "user_1", apiKey: "old" }),
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  }, { apiKey: "sk-new" });

  await (deleteApiKey as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => ({ _id: "secret_1", userId: "user_1", apiKey: "sk-new" }),
        }),
      }),
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
  }, {});

  assert.equal(patches[0]?.id, "secret_1");
  assert.equal(patches[0]?.value.apiKey, "sk-new");
  assert.deepEqual(deleted, ["secret_1"]);
});

test("scheduled job trigger tokens can be created, listed, rotated, and revoked", async () => {
  const inserted: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patched: Array<{ id: string; value: Record<string, unknown> }> = [];

  const created = await (createJobTriggerToken as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) => (id === "job_1" ? { _id: "job_1", userId: "user_1" } : null),
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => (table === "purchaseEntitlements" ? { _id: "ent_1", status: "active" } : null),
          collect: async () => [],
        }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserted.push({ table, value });
        return "token_1";
      },
    },
  }, {
    jobId: "job_1",
    label: "Zapier",
  });

  assert.equal(inserted[0]?.table, "scheduledJobTriggerTokens");
  assert.equal(inserted[0]?.value.label, "Zapier");
  assert.match(created.token, /^sk_sched_/);
  assert.equal(created.tokenId, "token_1");

  const listed = await (listJobTriggerTokens as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "job_1", userId: "user_1" }),
      query: () => ({
        withIndex: () => ({
          collect: async () => ([
            { _id: "tok_old", createdAt: 100, tokenPrefix: "sk_sched_old", status: "active" },
            { _id: "tok_new", createdAt: 200, tokenPrefix: "sk_sched_new", status: "active" },
          ]),
        }),
      }),
    },
  }, { jobId: "job_1" });

  assert.deepEqual(listed.map((token: any) => token._id), ["tok_new", "tok_old"]);

  const rotated = await (rotateJobTriggerToken as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) => (id === "job_1" ? { _id: "job_1", userId: "user_1" } : null),
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => (table === "purchaseEntitlements" ? { _id: "ent_1", status: "active" } : null),
          collect: async () => ([
            { _id: "tok_a", label: "Webhook", status: "active" },
            { _id: "tok_b", label: "Webhook", status: "active" },
          ]),
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patched.push({ id, value });
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserted.push({ table, value });
        return "token_2";
      },
    },
  }, { jobId: "job_1" });

  assert.equal(rotated.tokenId, "token_2");
  assert.equal(patched.length, 2);
  assert.ok(patched.every(({ value }) => value.status === "revoked"));

  const revoked: Array<{ id: string; value: Record<string, unknown> }> = [];
  await (revokeJobTriggerToken as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "tok_1", userId: "user_1", status: "active" }),
      query: () => ({
        withIndex: () => ({
          first: async () => ({ _id: "ent_1", status: "active" }),
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        revoked.push({ id, value });
      },
    },
  }, { tokenId: "tok_1" });

  assert.equal(revoked[0]?.id, "tok_1");
  assert.equal(revoked[0]?.value.status, "revoked");
});

test("triggerJobViaApi omits blank idempotency keys from stored audit rows", async () => {
  const inserts: Array<Record<string, unknown>> = [];

  const result = await (triggerJobViaApi as any)._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => null,
        }),
      }),
      insert: async (_table: string, value: Record<string, unknown>) => {
        inserts.push(value);
        return "audit_1";
      },
      patch: async () => undefined,
    },
    scheduler: {
      runAfter: async () => "sched_1",
    },
  }, {
    jobId: "job_1",
    userId: "user_1",
    requestId: "req_1",
    idempotencyKey: "   ",
  });

  assert.equal(result.duplicate, false);
  assert.equal(inserts[0]?.idempotencyKey, undefined);
});

test("fetchOpenRouterCredits returns remaining balance and maps upstream failures", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ data: { total_credits: 20, total_usage: 4.5 } }),
    })) as any;

    const success = await (fetchOpenRouterCredits as any)._handler({
      auth: buildAuth(),
      runQuery: async () => "sk-key",
    }, {});

    assert.deepEqual(success, { balance: 15.5 });

    globalThis.fetch = (async () => ({
      ok: false,
      status: 502,
    })) as any;

    await assert.rejects(
      (fetchOpenRouterCredits as any)._handler({
        auth: buildAuth(),
        runQuery: async () => "sk-key",
      }, {}),
      (error: unknown) => {
        assert.ok(error instanceof ConvexError);
        return (error as ConvexError<any>).data?.code === "EXTERNAL_SERVICE";
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
