import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

const CREDENTIAL_PREFIX = "nrh_";
const PAIRING_CODE_PREFIX = "nrp_";

export function runtimeHostError(code: string, message: string): ConvexError<{
  code: string;
  message: string;
}> {
  return new ConvexError({ code, message });
}

function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function createPairingCode(): string {
  return `${PAIRING_CODE_PREFIX}${randomHex(32)}`;
}

export function createShortPairingCode(): string {
  return `${PAIRING_CODE_PREFIX}${randomHex(8)}`;
}

export function createRuntimeCredential(): string {
  return `${CREDENTIAL_PREFIX}${randomHex(32)}`;
}

export function createRuntimeIdentifier(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function authenticateRuntimeHost(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  args: { deviceId: string; credentialId: string; credential: string },
): Promise<{
  credential: Doc<"runtimeDeviceCredentials">;
  device: Doc<"runtimeDevices">;
}> {
  const credential = await ctx.db
    .query("runtimeDeviceCredentials")
    .withIndex("by_credential_id", (query) =>
      query.eq("credentialId", args.credentialId),
    )
    .unique();
  const suppliedHash = await sha256Hex(args.credential);
  if (
    !credential
    || credential.status !== "active"
    || credential.deviceId !== args.deviceId
    || credential.credentialHash !== suppliedHash
  ) {
    throw runtimeHostError("UNAUTHORIZED", "Runtime Host credential is invalid or revoked");
  }
  const device = await ctx.db.get(credential.runtimeDeviceId);
  if (!device || device.status !== "active" || device.deviceId !== args.deviceId) {
    throw runtimeHostError("UNAUTHORIZED", "Runtime Host credential is invalid or revoked");
  }
  return { credential, device };
}

export function assertBoundedRuntimeString(
  value: string,
  field: string,
  maximum: number,
): void {
  if (value.length === 0 || value.length > maximum) {
    throw runtimeHostError(
      "VALIDATION_ERROR",
      `${field} must contain between 1 and ${maximum} characters`,
    );
  }
}
