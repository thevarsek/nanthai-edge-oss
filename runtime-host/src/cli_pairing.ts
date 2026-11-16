import { prepareCredentialRotation, finishCredentialRotation } from "./credential_rotation.ts";
import { HostLock } from "./host_lock.ts";
import { hostname } from "node:os";
import { z } from "zod";
import { controlPlaneOrigin } from "./control_plane_origin.ts";
import type { CliDependencies } from "./cli.ts";

export async function preparePairing(dependencies: CliDependencies): Promise<number> {
  if (!dependencies.stdin) throw new Error("Pairing requires standard input");
  const args = z.array(z.string()).parse(JSON.parse(await dependencies.stdin()));
  if (args[0] === "pair") return pair(args[1], args[2], dependencies, args.slice(3), false, true);
  if (args[0] === "pair-code") return pair(undefined, args[1], dependencies, args.slice(2), true, true);
  throw new Error("Invalid pairing request");
}

export async function pair(
  pairingId: string | undefined,
  oneTimeCode: string | undefined,
  dependencies: CliDependencies,
  options: readonly string[] = [],
  shortCode = false,
  prepareOnly = false,
) {
  if ((!shortCode && (pairingId === undefined || pairingId.trim().length === 0))
    || oneTimeCode === undefined || oneTimeCode.trim().length === 0) {
    throw new Error("Usage: nanthai pair <pairing-id> <one-time-code>");
  }
  if (options.length && (options.length !== 2 || options[0] !== "--server")) {
    throw new Error("Usage: nanthai pair <pairing-id> <one-time-code> [--server <URL>]");
  }
  const controlPlaneUrl = options[1];
  if (controlPlaneUrl) {
    controlPlaneOrigin(controlPlaneUrl);
  }
  const credential = await dependencies.pairing.pair({
    ...(shortCode ? { shortCode: true as const } : { pairingId: pairingId ?? "" }),
    oneTimeCode,
    hostname: hostname(),
    platform: process.platform,
    architecture: process.arch,
    ...(controlPlaneUrl ? { controlPlaneUrl } : {}),
  });
  if (prepareOnly) {
    if (!credential.accountId) throw new Error("Update the NanthAI server before pairing: the account identity is missing.");
    dependencies.stdout(JSON.stringify(credential));
    return 0;
  }
  const stored = { ...credential };
  delete stored.accountEmail;
  await dependencies.credentials.writeDeviceCredential(stored);
  dependencies.stdout(JSON.stringify({ paired: true, deviceId: credential.deviceId }));
  return 0;
}

export async function credentialCommand(command: string | undefined, dependencies: CliDependencies): Promise<number> {
  const lock = dependencies.credentialLockPath ? await HostLock.acquire(dependencies.credentialLockPath, "tray") : null;
  try {
    const current = await dependencies.credentials.readDeviceCredential();
    if (!current) throw new Error("This Mac is not paired");
    if (current.previousCredentialId) {
      await finishCredentialRotation(current, current.previousCredentialId);
      delete current.previousCredentialId;
    }
    if (command === "prepare-rotation") dependencies.stdout(JSON.stringify(await prepareCredentialRotation(current)));
    else if (command === "finish-rotation") dependencies.stdout(JSON.stringify(current));
    else throw new Error("Unknown credential operation");
    return 0;
  } finally { await lock?.release(); }
}
