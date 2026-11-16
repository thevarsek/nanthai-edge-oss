import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryCredentialStore } from "../src/credential_store.ts";
import { rotateStoredCredential } from "../src/credential_rotation.ts";

const old = { deviceId: "device", credentialId: "old", credential: "old-secret", controlPlaneUrl: "https://safe.test" };
const next = { ...old, credentialId: "new", credential: "new-secret" };

test("rotation persists before revocation and retries a lost finalization without losing pairing", async () => {
  const root = await mkdtemp(join(tmpdir(), "nanthai-rotation-"));
  const store = new InMemoryCredentialStore(old);
  let fail = true;
  const finalized: string[] = [];
  try {
    const finish = async (value: typeof old, previous: string) => {
      assert.equal((await store.readDeviceCredential())?.credentialId, value.credentialId);
      if (fail) throw new Error("lost acknowledgement");
      finalized.push(previous);
    };
    await assert.rejects(rotateStoredCredential(store, join(root, "lock"), async () => ({ ...next }), finish));
    assert.deepEqual(await store.readDeviceCredential(), { ...next, previousCredentialId: "old" });
    fail = false;
    await rotateStoredCredential(store, join(root, "lock"), async current => ({ ...current, credentialId: "newer" }), finish);
    assert.deepEqual(finalized, ["old", "new"]);
    assert.equal((await store.readDeviceCredential())?.previousCredentialId, undefined);
    assert.equal((await store.readDeviceCredential())?.credentialId, "newer");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unavailable rotation and failed local persistence keep the old credential usable", async () => {
  const root = await mkdtemp(join(tmpdir(), "nanthai-rotation-"));
  const store = new InMemoryCredentialStore(old);
  let revocations = 0;
  try {
    const finish = async () => { revocations++; };
    await assert.rejects(rotateStoredCredential(store, join(root, "lock"), async () => { throw new Error("older server"); }, finish));
    assert.deepEqual(await store.readDeviceCredential(), old);
    store.writeDeviceCredential = async () => { throw new Error("Keychain unavailable"); };
    await assert.rejects(rotateStoredCredential(store, join(root, "lock"), async () => ({ ...next }), finish));
    assert.deepEqual(await store.readDeviceCredential(), old);
    assert.equal(revocations, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
