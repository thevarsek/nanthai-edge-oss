import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import type { DeviceCredential } from "./control_plane.ts";
import type { CredentialStore } from "./credential_store.ts";


export const DeviceCredentialSchema = z.strictObject({
  deviceId: z.string().min(1),
  credentialId: z.string().min(1),
  controlPlaneUrl: z.string().url(),
  credential: z.string().min(1),
  accountId: z.string().min(1).optional(),
  previousCredentialId: z.string().min(1).optional(),
});

export type KeychainCommandRunner = (
  args: readonly string[],
  input?: string,
) => Promise<{ stdout: string }>;

export class MacOSKeychainCredentialStore implements CredentialStore {
  constructor(
    private readonly runKeychain: KeychainCommandRunner = defaultKeychainRunner,
  ) {}

  async readDeviceCredential(): Promise<DeviceCredential | null> {
    try {
      const result = await this.runKeychain([
        "read",
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
      await this.runKeychain([
        "write",
      ], JSON.stringify(validated));
    } catch {
      throw credentialError("save");
    }
  }

  async deleteDeviceCredential(): Promise<void> {
    try {
      await this.runKeychain([
        "delete",
      ]);
    } catch (error) {
      if (!isMissingKeychainItem(error)) throw credentialError("remove");
    }
  }
}

function credentialError(operation: string): Error {
  // Never expose native helper output or subprocess details.
  return new Error(`macOS Keychain could not ${operation} the NanthAI device credential. Unlock the login Keychain and try again.`);
}

async function defaultKeychainRunner(args: readonly string[], input?: string): Promise<{ stdout: string }> {
  const helper = fileURLToPath(new URL(import.meta.url.endsWith(".mjs")
    ? "../runtime/NanthAIKeychain" : "../macos-menu/.build/debug/NanthAIKeychain", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = execFile(helper, [...args], { encoding: "utf8", maxBuffer: 64 * 1024 }, (error, stdout) => {
      if (error) reject(error); else resolve({ stdout });
    });
    child.stdin?.once("error", reject);
    child.stdin?.end(input ?? "");
  });
}

function isMissingKeychainItem(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  return code === 44 || code === "44" || /could not be found/i.test(error.message);
}
