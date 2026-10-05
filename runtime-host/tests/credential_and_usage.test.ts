import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InMemoryCredentialStore } from "../src/credential_store.ts";
import { MacOSKeychainCredentialStore } from "../src/macos_keychain_store.ts";
import { UsageHistory } from "../src/usage_history.ts";

const credential = {
  deviceId: "device-1",
  credentialId: "credential-1",
  controlPlaneUrl: "https://example.test",
  credential: "secret-token",
};

test("memory credential store returns copies", async () => {
  const store = new InMemoryCredentialStore();
  await store.writeDeviceCredential(credential);
  const first = await store.readDeviceCredential();
  assert.deepEqual(first, credential);
  if (first !== null) first.credential = "changed";
  assert.deepEqual(await store.readDeviceCredential(), credential);
  await store.deleteDeviceCredential();
  assert.equal(await store.readDeviceCredential(), null);
});

test("macOS credential store delegates secret persistence to Keychain", async () => {
  const calls: readonly string[][] = [];
  const mutableCalls = calls as string[][];
  let stored: string | null = null;
  const store = new MacOSKeychainCredentialStore("service", "account", async (args) => {
    mutableCalls.push([...args]);
    if (args[0] === "add-generic-password") {
      stored = args.at(-1) ?? null;
      return { stdout: "" };
    }
    if (args[0] === "find-generic-password" && stored !== null) return { stdout: stored };
    if (args[0] === "delete-generic-password") {
      stored = null;
      return { stdout: "" };
    }
    const error = new Error("The specified item could not be found in the keychain");
    (error as Error & { code: number }).code = 44;
    throw error;
  });
  assert.equal(await store.readDeviceCredential(), null);
  await store.writeDeviceCredential(credential);
  assert.deepEqual(await store.readDeviceCredential(), credential);
  await store.deleteDeviceCredential();
  assert.equal(await store.readDeviceCredential(), null);
  assert.equal(calls.some((args) => args.includes("-U")), true);
});

test("usage history keeps truthful monthly model and cost buckets without expiry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-usage-"));
  const history = new UsageHistory(join(directory, "usage.json"));
  try {
    await history.record(observation(Date.UTC(2026, 7, 1), 10, {
      source: "provider_reported", amount: 1.25, currency: "USD",
    }));
    await history.record(observation(Date.UTC(2026, 7, 2), null, {
      source: "unpriced", reason: "Provider did not return a price",
    }));
    await history.record(observation(Date.UTC(2025, 0, 1), 3, {
      source: "api_equivalent_estimate", amount: 0.2, currency: "USD",
      pricingVersion: "openai-2025-01",
    }));
    const months = await history.list();
    assert.deepEqual(months.map((month) => month.month), ["2026-08", "2025-01"]);
    assert.equal(months[0]?.turnReports, 2);
    assert.deepEqual(months[0]?.tokens.total, { known: 10, unavailableReports: 1 });
    assert.equal(months[0]?.costs[0]?.amount, 1.25);
    assert.equal(months[0]?.unpricedReports, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Keychain failures never expose subprocess arguments or malformed stored secrets", async () => {
  const store = new MacOSKeychainCredentialStore("service", "account", async (args) => {
    throw new Error(`Command failed: security ${args.join(" ")} ${credential.credential}`);
  });
  for (const [operation, action] of [
    ["read", () => store.readDeviceCredential()],
    ["save", () => store.writeDeviceCredential(credential)],
    ["remove", () => store.deleteDeviceCredential()],
  ] as const) {
    await assert.rejects(action, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(`could not ${operation}`));
      assert.ok(error.message.includes("Unlock the login Keychain"));
      assert.equal(error.message.includes(credential.credential), false);
      assert.equal(error.message.includes("Command failed"), false);
      return true;
    });
  }
  const malformed = new MacOSKeychainCredentialStore("service", "account", async () => ({ stdout: "secret-token is not JSON" }));
  await assert.rejects(() => malformed.readDeviceCredential(), /^Error: macOS Keychain could not read/);
});

function observation(
  occurredAtMs: number,
  total: number | null,
  cost: Parameters<UsageHistory["record"]>[0]["cost"],
) {
  return {
    occurredAtMs,
    provider: "openai",
    modelId: "gpt-test",
    tokens: { input: total, output: 0, cachedInput: null, reasoning: null, total },
    cost,
  };
}
