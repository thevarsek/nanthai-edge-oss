import type { CliDependencies } from "./cli.ts";
import { RuntimeHttpError } from "./http_json_client.ts";

// EX_NOPERM is a terminal pairing failure, not a crashed process to restart.
export const RUNTIME_RECONNECT_EXIT_CODE = 77;

export function runtimeAuthorizationRejected(error: unknown): boolean {
  return error instanceof RuntimeHttpError && error.status === 401
    && error.code === "UNAUTHORIZED";
}

export async function startRuntime(
  dependencies: CliDependencies,
  options: readonly string[],
): Promise<number> {
  const owner = options[0] === "--owner" && options[1] === "tray" ? "tray" : "foreground_cli";
  if (dependencies.rotateCredential) {
    // An older/offline backend leaves the existing authority usable. No forced re-pairing.
    try { await dependencies.rotateCredential(); }
    catch { dependencies.stderr("Device credential rotation is pending; the saved pairing is retained."); }
  }
  const credential = await dependencies.credentials.readDeviceCredential();
  if (credential === null) throw new Error("This machine is not paired; run nanthai pair first");
  dependencies.stdout(JSON.stringify({ state: "starting", deviceId: credential.deviceId, owner }));
  try {
    await dependencies.hostFactory.create(credential, owner).run(dependencies.shutdownSignal);
    return 0;
  } catch (error) {
    if (runtimeAuthorizationRejected(error)) {
      try {
        const current = await dependencies.credentials.readDeviceCredential();
        // Pairing may have replaced the credential while the old host shut down.
        if (current?.credentialId === credential.credentialId && current.credential === credential.credential) {
          await dependencies.savedWork?.removeDevice?.(credential.deviceId, credential.controlPlaneUrl);
          await dependencies.credentials.deleteDeviceCredential();
        }
      } catch {
        dependencies.stderr("Could not remove the rejected pairing. Reconnect NanthAI from the Mac app.");
      }
    }
    throw error;
  }
}
