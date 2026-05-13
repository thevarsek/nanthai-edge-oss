import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { Sandbox } from "@vercel/sandbox";

import { cleanStaleSandboxSessions } from "../runtime/cleanup";

function withSandboxEnv(enabled: boolean) {
  const previous = {
    token: process.env.VERCEL_SANDBOX_TOKEN,
    projectId: process.env.VERCEL_SANDBOX_PROJECT_ID,
    teamId: process.env.VERCEL_SANDBOX_TEAM_ID,
  };
  if (enabled) {
    process.env.VERCEL_SANDBOX_TOKEN = "token";
    process.env.VERCEL_SANDBOX_PROJECT_ID = "project";
    process.env.VERCEL_SANDBOX_TEAM_ID = "team";
  } else {
    delete process.env.VERCEL_SANDBOX_TOKEN;
    delete process.env.VERCEL_SANDBOX_PROJECT_ID;
    delete process.env.VERCEL_SANDBOX_TEAM_ID;
  }
  return () => {
    if (previous.token === undefined) delete process.env.VERCEL_SANDBOX_TOKEN;
    else process.env.VERCEL_SANDBOX_TOKEN = previous.token;
    if (previous.projectId === undefined) delete process.env.VERCEL_SANDBOX_PROJECT_ID;
    else process.env.VERCEL_SANDBOX_PROJECT_ID = previous.projectId;
    if (previous.teamId === undefined) delete process.env.VERCEL_SANDBOX_TEAM_ID;
    else process.env.VERCEL_SANDBOX_TEAM_ID = previous.teamId;
  };
}

test("cleanStaleSandboxSessions returns early when there are no stale sessions", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  await (cleanStaleSandboxSessions as any)._handler({
    runQuery: async () => ({ sessions: [], hitBatchLimit: false }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => mutations.push(args),
    scheduler: { runAfter: async () => "scheduled" },
  });

  assert.deepEqual(mutations, []);
});

test("cleanStaleSandboxSessions marks stale rows without VM credentials", async () => {
  const restoreEnv = withSandboxEnv(false);
  const mutations: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const getMock = mock.method(Sandbox, "get", async () => {
    throw new Error("credentials absent, should not call Sandbox.get");
  });

  await (cleanStaleSandboxSessions as any)._handler({
    runQuery: async () => ({
      hitBatchLimit: true,
      sessions: [
        { id: "session_1", hasVm: true, providerSandboxId: "sbx_1" },
        { id: "session_2", hasVm: false, providerSandboxId: null },
      ],
    }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => mutations.push(args),
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "scheduled";
      },
    },
  });

  assert.deepEqual(mutations[0].sessionIds, ["session_1", "session_2"]);
  assert.equal(scheduled.length, 1);
  assert.equal(getMock.mock.callCount(), 0);

  getMock.mock.restore();
  restoreEnv();
});

test("cleanStaleSandboxSessions best-effort attempts live VMs and still marks failures", async () => {
  const restoreEnv = withSandboxEnv(true);
  const mutations: Array<Record<string, unknown>> = [];
  const getMock = mock.method(Sandbox, "get", async ({ sandboxId }: { sandboxId: string }) => {
    if (sandboxId === "sbx_missing") throw new Error("already gone");
    return { stop: async () => undefined } as any;
  });

  await (cleanStaleSandboxSessions as any)._handler({
    runQuery: async () => ({
      hitBatchLimit: false,
      sessions: [
        { id: "session_live", hasVm: true, providerSandboxId: "sbx_live" },
        { id: "session_missing", hasVm: true, providerSandboxId: "sbx_missing" },
        { id: "session_no_id", hasVm: true, providerSandboxId: "" },
      ],
    }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => mutations.push(args),
    scheduler: { runAfter: async () => "scheduled" },
  });

  assert.deepEqual(mutations[0].sessionIds, ["session_live", "session_missing", "session_no_id"]);

  getMock.mock.restore();
  restoreEnv();
});
