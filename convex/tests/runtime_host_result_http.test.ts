import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import { publishResultHttp } from "../runtime_host/http_results";

test("upload failure never claims publication; a fenced rejection removes only its uncommitted upload", async () => {
  for (const failAt of ["upload", "commit"] as const) {
    let calls = 0;
    const deleted: string[] = [];
    const ctx = {
      runMutation: async () => { if (++calls === 2) throw new ConvexError({ code: "STALE_FENCE", message: "This attempt has ended" }); return null; },
      storage: {
        store: async () => { if (failAt === "upload") throw new Error("Storage offline"); return "uncommitted-blob"; },
        delete: async (id: string) => { deleted.push(id); },
      },
    } as unknown as ActionCtx;
    const response = await publishResultHttp(ctx, new Request("https://example.test/runtime-host/results/publish", {
      method: "POST", headers: { Authorization: "Bearer test-credential", "X-NanthAI-Device-ID": "device-1", "X-NanthAI-Credential-ID": "credential-1", "X-NanthAI-Presence-Session-ID": "presence-1", "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId: "attempt-1", fence: 7, callId: "call-1", filename: "answer.md", mimeType: "text/markdown", content: "Result" }),
    }));
    assert.equal(response.ok, false);
    assert.equal((await response.json()).published, undefined);
    assert.equal(calls, failAt === "upload" ? 1 : 2);
    assert.deepEqual(deleted, failAt === "upload" ? [] : ["uncommitted-blob"]);
  }
});
