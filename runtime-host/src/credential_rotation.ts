import { randomBytes, randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";
import type { DeviceCredential } from "./control_plane.ts";
import type { CredentialStore } from "./credential_store.ts";
import { HttpJsonClient } from "./http_json_client.ts";
import { acceptedRealtimeUrl } from "./convex_pending_work_source.ts";
import { HostLock } from "./host_lock.ts";

type Auth = Pick<DeviceCredential, "deviceId" | "credentialId" | "credential">;
const prepareRef = makeFunctionReference<"mutation", Auth & { nextCredentialId: string; nextCredential: string }, null>(
  "runtime_host/credentials:prepareRotation");
const finishRef = makeFunctionReference<"mutation", Auth & { previousCredentialId: string }, null>(
  "runtime_host/credentials:finishRotation");

async function rotationClient(credential: DeviceCredential): Promise<ConvexHttpClient> {
  const response = await new HttpJsonClient(credential.controlPlaneUrl).post("/runtime-host/v1/realtime", {},
    z.object({ realtimeUrl: z.string() }));
  const url = acceptedRealtimeUrl(credential.controlPlaneUrl, response.realtimeUrl);
  if (!url) throw new Error("Credential rotation requires a protected deployment URL");
  return new ConvexHttpClient(url, { skipConvexDeploymentUrlCheck: true });
}
function auth(credential: DeviceCredential): Auth {
  return { deviceId: credential.deviceId, credentialId: credential.credentialId, credential: credential.credential };
}
export async function prepareCredentialRotation(current: DeviceCredential): Promise<DeviceCredential> {
  const next = { ...current, previousCredentialId: current.credentialId, credentialId: `credential_${randomUUID()}`, credential: `nrh_${randomBytes(32).toString("hex")}` };
  await (await rotationClient(current)).mutation(prepareRef, { ...auth(current),
    nextCredentialId: next.credentialId, nextCredential: next.credential });
  return next;
}
export async function finishCredentialRotation(current: DeviceCredential, previousCredentialId: string): Promise<void> {
  await (await rotationClient(current)).mutation(finishRef, { ...auth(current), previousCredentialId });
}

/** Persist the replacement before revoking its predecessor. A lost reply cannot strand the Mac. */
export async function rotateStoredCredential(store: CredentialStore, lockPath: string,
  prepare = prepareCredentialRotation, finish = finishCredentialRotation): Promise<void> {
  const lock = await HostLock.acquire(lockPath, "foreground_cli");
  try {
    const current = await store.readDeviceCredential();
    if (!current) return;
    if (current.previousCredentialId) {
      await finish(current, current.previousCredentialId);
      delete current.previousCredentialId;
      await store.writeDeviceCredential(current);
    }
    const next = await prepare(current);
    // Store pending predecessor identity too, so a failed/lost finalize is retried after restart.
    next.previousCredentialId = current.credentialId;
    await store.writeDeviceCredential(next);
    await finish(next, current.credentialId);
    delete next.previousCredentialId;
    await store.writeDeviceCredential(next);
  } finally { await lock.release(); }
}
