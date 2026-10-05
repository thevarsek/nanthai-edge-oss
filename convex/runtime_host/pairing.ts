import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import { closeRunWriterForCancellation } from "../execution/cancel_fence";
import { requireAuth, requirePro } from "../lib/auth";
import { PAIRING_PROTOCOL_VERSION } from "./protocol_common";
import {
  assertBoundedRuntimeString,
  createPairingCode,
  createShortPairingCode,
  createRuntimeCredential,
  createRuntimeIdentifier,
  runtimeHostError,
  sha256Hex,
} from "./security";

const PAIRING_TTL_MS = 10 * 60 * 1_000;

const operatingSystem = v.union(
  v.literal("macos"),
  v.literal("windows"),
  v.literal("linux"),
);
const architecture = v.union(v.literal("arm64"), v.literal("x64"));

const pairingInitiation = v.object({
  protocolVersion: v.literal(PAIRING_PROTOCOL_VERSION),
  pairingId: v.string(),
  oneTimeCode: v.string(),
  expiresAt: v.number(),
  pairingCommand: v.optional(v.string()),
  pairingCode: v.optional(v.string()),
  serverOrigin: v.optional(v.string()),
});

export const pairingGrant = v.object({
  protocolVersion: v.literal(PAIRING_PROTOCOL_VERSION),
  pairingId: v.string(),
  deviceId: v.string(),
  credentialId: v.string(),
  credential: v.string(),
  issuedAt: v.number(),
});

export async function beginPairingHandler(
  ctx: MutationCtx,
  userId: string,
  now = Date.now(),
  shortCode = false,
) {
  const pairingId = createRuntimeIdentifier("pairing");
  const oneTimeCode = shortCode ? createShortPairingCode() : createPairingCode();
  const expiresAt = now + PAIRING_TTL_MS;
  await ctx.db.insert("runtimePairingRequests", {
    userId,
    pairingId,
    codeHash: await sha256Hex(oneTimeCode),
    status: "pending",
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  const server = process.env.CONVEX_SITE_URL;
  const pairingCommand = `nanthai pair ${pairingId} ${oneTimeCode}${server ? ` --server ${new URL(server).origin}` : ""}`;
  return { protocolVersion: PAIRING_PROTOCOL_VERSION, pairingId, oneTimeCode, expiresAt, pairingCommand,
    ...(shortCode ? { pairingCode: oneTimeCode.slice(4).toUpperCase().replace(/(.{4})(?=.)/g, "$1-") } : {}),
    ...(server ? { serverOrigin: new URL(server).origin } : {}) };
}

export const beginPairing = mutation({
  args: { shortCode: v.optional(v.boolean()) },
  returns: pairingInitiation,
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    return await beginPairingHandler(ctx, userId, Date.now(), args.shortCode ?? false);
  },
});

export async function claimPairingHandler(
  ctx: MutationCtx,
  args: {
    pairingId: string;
    oneTimeCode: string;
    hostNonce: string;
    hostPublicKey: string;
    displayName: string;
    operatingSystem: "macos" | "windows" | "linux";
    architecture: "arm64" | "x64";
    platformRelease: string;
    hostVersion: string;
    now?: number;
  },
) {
  const now = args.now ?? Date.now();
  assertBoundedRuntimeString(args.hostNonce, "Host nonce", 512);
  assertBoundedRuntimeString(args.hostPublicKey, "Host public key", 8_192);
  assertBoundedRuntimeString(args.displayName, "Device name", 512);
  assertBoundedRuntimeString(args.platformRelease, "Platform release", 200);
  assertBoundedRuntimeString(args.hostVersion, "Host version", 256);
  const pairing = await ctx.db
    .query("runtimePairingRequests")
    .withIndex("by_pairing_id", (query) => query.eq("pairingId", args.pairingId))
    .unique();
  if (!pairing || pairing.status !== "pending") {
    throw runtimeHostError("PAIRING_INVALID", "Pairing request is invalid or already used");
  }
  if (pairing.expiresAt <= now) {
    await ctx.db.patch(pairing._id, { status: "expired", updatedAt: now });
    throw runtimeHostError("PAIRING_EXPIRED", "Pairing request has expired");
  }
  if (pairing.codeHash !== await sha256Hex(args.oneTimeCode)) {
    throw runtimeHostError("PAIRING_INVALID", "Pairing request is invalid or already used");
  }
  const deviceId = createRuntimeIdentifier("device");
  const credentialId = createRuntimeIdentifier("credential");
  const credential = createRuntimeCredential();
  const runtimeDeviceId = await ctx.db.insert("runtimeDevices", {
    userId: pairing.userId,
    deviceId,
    displayName: args.displayName,
    status: "active",
    operatingSystem: args.operatingSystem,
    architecture: args.architecture,
    platformRelease: args.platformRelease,
    hostVersion: args.hostVersion,
    hostPublicKey: args.hostPublicKey,
    currentCredentialId: credentialId,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("runtimeDeviceCredentials", {
    userId: pairing.userId,
    runtimeDeviceId,
    deviceId,
    credentialId,
    credentialPrefix: credential.slice(0, 12),
    credentialHash: await sha256Hex(credential),
    status: "active",
    issuedAt: now,
  });
  await ctx.db.patch(pairing._id, {
    status: "claimed",
    claimedDeviceId: runtimeDeviceId,
    consumedAt: now,
    updatedAt: now,
  });
  return {
    protocolVersion: PAIRING_PROTOCOL_VERSION,
    pairingId: pairing.pairingId,
    deviceId,
    credentialId,
    credential,
    issuedAt: now,
  };
}

export const claimPairing = mutation({
  args: {
    protocolVersion: v.literal(PAIRING_PROTOCOL_VERSION),
    pairingId: v.string(),
    oneTimeCode: v.string(),
    hostNonce: v.string(),
    hostPublicKey: v.string(),
    device: v.object({
      displayName: v.string(),
      platform: v.object({ operatingSystem, architecture, release: v.string() }),
      hostVersion: v.string(),
    }),
  },
  returns: pairingGrant,
  handler: async (ctx, args) => await claimPairingHandler(ctx, {
    pairingId: args.pairingId,
    oneTimeCode: args.oneTimeCode,
    hostNonce: args.hostNonce,
    hostPublicKey: args.hostPublicKey,
    displayName: args.device.displayName,
    operatingSystem: args.device.platform.operatingSystem,
    architecture: args.device.platform.architecture,
    platformRelease: args.device.platform.release,
    hostVersion: args.device.hostVersion,
  }),
});

async function closeDeviceAttempts(
  ctx: MutationCtx,
  deviceId: string,
  requestedBy: string,
  reason: string,
): Promise<void> {
  const attempts = (await Promise.all(
    (["queued", "claimed", "running", "waiting", "interrupted"] as const).map((status) =>
      ctx.db.query("executionAttempts")
        .withIndex("by_device_status", (query) =>
          query.eq("deviceId", deviceId).eq("status", status),
        )
        .collect(),
    ),
  )).flat();
  for (const attempt of attempts) {
    const run = await ctx.db.get(attempt.runId);
    if (!run || run.activeAttemptId !== attempt._id) continue;
    // Fence every run here; each owned action advances its paginated teardown.
    // A device may have several runs, but Convex permits one page query per call.
    await closeRunWriterForCancellation(ctx, run._id, requestedBy, reason);
    await ctx.scheduler.runAfter(0, internal.execution.teardown.cancelRunTree, {
      runId: run._id,
      requestedBy,
      reason,
    });
  }
}

export async function revokeDeviceHandler(
  ctx: MutationCtx,
  args: { userId: string; runtimeDeviceId: Id<"runtimeDevices">; reason: string; now?: number },
): Promise<boolean> {
  const device = await ctx.db.get(args.runtimeDeviceId);
  if (!device || device.userId !== args.userId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Paired machine not found" });
  }
  if (device.status === "revoked") return false;
  const now = args.now ?? Date.now();
  const reason = args.reason.trim().slice(0, 2_000) || "Paired machine removed";
  const [credentials, presences] = await Promise.all([
    ctx.db.query("runtimeDeviceCredentials")
      .withIndex("by_device_status", (query) =>
        query.eq("runtimeDeviceId", device._id).eq("status", "active"),
      ).collect(),
    ctx.db.query("runtimeDevicePresences")
      .withIndex("by_device_status", (query) =>
        query.eq("runtimeDeviceId", device._id).eq("status", "online"),
      ).collect(),
  ]);
  for (const credential of credentials) {
    await ctx.db.patch(credential._id, {
      status: "revoked",
      revokedAt: now,
      revocationReason: reason,
    });
  }
  for (const presence of presences) {
    await ctx.db.patch(presence._id, {
      status: "offline",
      disconnectedAt: now,
      disconnectReason: "device_revoked",
    });
  }
  await ctx.db.patch(device._id, {
    status: "revoked",
    currentPresenceId: undefined,
    revokedAt: now,
    revocationReason: reason,
    updatedAt: now,
  });
  await closeDeviceAttempts(ctx, device.deviceId, args.userId, reason);
  return true;
}

export const revokeDevice = mutation({
  args: { runtimeDeviceId: v.id("runtimeDevices"), reason: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    return await revokeDeviceHandler(ctx, { userId, ...args });
  },
});
