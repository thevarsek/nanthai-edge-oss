import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CanonicalUsageHistory } from "../src/canonical_usage_history.ts";
import { InMemoryCredentialStore } from "../src/credential_store.ts";
import { RuntimeHttpError } from "../src/http_json_client.ts";
import { createMonth } from "../../shared/runtime_usage.mts";

const credential = { deviceId: "device-1", credentialId: "credential-1", credential: "secret", controlPlaneUrl: "https://example.test" };
const month = (year: number, tokens: number) => createMonth(`${year}-01`, {
  occurredAtMs: Date.UTC(year, 0, 1), provider: "openai", modelId: "actual-model",
  tokens: { input: tokens, output: 0, total: tokens, cachedInput: null, reasoning: null },
  cost: { source: "unpriced", reason: "Subscription does not report a price" },
});
const page = (months: ReturnType<typeof month>[], isDone: boolean, continueCursor = "done") => ({
  userId: "user-1", deviceId: "device-1", throughMs: 123, months, isDone, continueCursor,
});

test("rebuilds all canonical months, merges page boundaries and retains scoped offline history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canonical-usage-"));
  const store = new InMemoryCredentialStore(); await store.writeDeviceCredential(credential);
  let offline = false;
  const bodies: unknown[] = [];
  const reader = new CanonicalUsageHistory(store, directory, async (_input, init) => {
    if (offline) throw new Error("offline");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer secret");
    const body = JSON.parse(String(init?.body)) as { cursor: string | null };
    bodies.push(body);
    return Response.json(body.cursor === null ? page([month(2026, 10)], false, "next")
      : page([month(2026, 5), month(2024, 3)], true));
  });
  try {
    const result = await reader.list();
    assert.deepEqual(result.map(value => [value.month, value.tokens.total.known]), [["2026-01", 15], ["2024-01", 3]]);
    assert.equal(result[0]?.turnReports, 2);
    assert.equal(result[0]?.tokens.cachedInput.unavailableReports, 2);
    assert.deepEqual(bodies, [{ cursor: null }, { cursor: "next", throughMs: 123 }]);
    offline = true;
    assert.deepEqual(await reader.list(), result);
    assert.deepEqual(await reader.list("2024-01"), [result[1]]);
    await store.writeDeviceCredential({ ...credential, credentialId: "rotated" });
    assert.deepEqual(await reader.list(), result);
    await store.writeDeviceCredential({ ...credential, deviceId: "another-account-mac" });
    await assert.rejects(reader.list(), (error: unknown) => error instanceof RuntimeHttpError && error.status === 0);
    await store.deleteDeviceCredential(); assert.deepEqual(await reader.list(), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("never stores partial pages and never substitutes an offline cache for rejected authorization", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canonical-usage-"));
  const store = new InMemoryCredentialStore(); await store.writeDeviceCredential(credential);
  let mode: "complete" | "partial" | "denied" = "complete";
  const reader = new CanonicalUsageHistory(store, directory, async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { cursor: string | null };
    if (mode === "denied") return Response.json({ error: { code: "UNAUTHORIZED", message: "Revoked" } }, { status: 401 });
    if (mode === "partial" && body.cursor !== null) throw new Error("offline after first page");
    return Response.json(mode === "complete" ? page([month(2024, 3)], true) : page([month(2026, 99)], false, "next"));
  });
  try {
    const expected = await reader.list(); mode = "partial";
    assert.deepEqual(await reader.list(), expected);
    assert.equal((await readdir(directory)).filter(name => name.endsWith(".json")).length, 1);
    mode = "denied";
    await assert.rejects(reader.list(), (error: unknown) => error instanceof RuntimeHttpError && error.status === 401);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("rejects a foreign or changing canonical snapshot before caching it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canonical-usage-"));
  const store = new InMemoryCredentialStore(); await store.writeDeviceCredential(credential);
  const reader = new CanonicalUsageHistory(store, directory, async () => Response.json({ ...page([], true), deviceId: "foreign" }));
  try { await assert.rejects(reader.list(), /another account or snapshot/); assert.deepEqual(await readdir(directory), []); }
  finally { await rm(directory, { recursive: true, force: true }); }
});
