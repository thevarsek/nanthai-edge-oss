import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

import type { DeviceCredential } from "./control_plane.ts";
import type { CredentialStore } from "./credential_store.ts";

const execFileAsync = promisify(execFile);

const DeviceCredentialSchema = z.strictObject({
  deviceId: z.string().min(1),
  credentialId: z.string().min(1),
  controlPlaneUrl: z.string().url(),
  credential: z.string().min(1),
});

export type SecurityCommandRunner = (
  args: readonly string[],
) => Promise<{ stdout: string }>;

export class MacOSKeychainCredentialStore implements CredentialStore {
  constructor(
    private readonly service = "ai.nanthai.runtime-host",
    private readonly account = "paired-device",
    private readonly runSecurity: SecurityCommandRunner = defaultSecurityRunner,
  ) {}

  async readDeviceCredential(): Promise<DeviceCredential | null> {
    try {
      const result = await this.runSecurity([
        "find-generic-password", "-a", this.account, "-s", this.service, "-w",
      ]);
      return DeviceCredentialSchema.parse(JSON.parse(result.stdout.trim()) as unknown);
    } catch (error) {
      if (isMissingKeychainItem(error)) return null;
      throw credentialError("read");
    }
  }

  async writeDeviceCredential(credential: DeviceCredential): Promise<void> {
    const validated = DeviceCredentialSchema.parse(credential);
    try {
      await this.runSecurity([
        "add-generic-password", "-U", "-a", this.account, "-s", this.service,
        "-w", JSON.stringify(validated),
      ]);
    } catch {
      throw credentialError("save");
    }
  }

  async deleteDeviceCredential(): Promise<void> {
    try {
      await this.runSecurity([
        "delete-generic-password", "-a", this.account, "-s", this.service,
      ]);
    } catch (error) {
      if (!isMissingKeychainItem(error)) throw credentialError("remove");
    }
  }
}

function credentialError(operation: string): Error {
  // execFile errors include the full command, including the secret passed to -w.
  return new Error(`macOS Keychain could not ${operation} the NanthAI device credential. Unlock the login Keychain and try again.`);
}

async function defaultSecurityRunner(args: readonly string[]): Promise<{ stdout: string }> {
  const result = await execFileAsync("security", [...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024,
  });
  return { stdout: result.stdout };
}

function isMissingKeychainItem(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  return code === 44 || code === "44" || /could not be found/i.test(error.message);
}
