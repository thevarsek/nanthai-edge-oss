import { mutation } from "../_generated/server";
import { v } from "convex/values";
import {
  authenticateRuntimeHost,
  runtimeHostError,
  createRuntimeCredential,
  createRuntimeIdentifier,
  sha256Hex,
} from "./security";

const rotatedCredential = v.object({
  credentialId: v.string(),
  credential: v.string(),
  issuedAt: v.number(),
});

export const rotate = mutation({
  args: {
    deviceId: v.string(),
    credentialId: v.string(),
    credential: v.string(),
  },
  returns: rotatedCredential,
  handler: async (ctx, args) => {
    const { credential: current, device } = await authenticateRuntimeHost(ctx, args);
    const now = Date.now();
    const credentialId = createRuntimeIdentifier("credential");
    const credential = createRuntimeCredential();
    await ctx.db.insert("runtimeDeviceCredentials", {
      userId: device.userId,
      runtimeDeviceId: device._id,
      deviceId: device.deviceId,
      credentialId,
      credentialPrefix: credential.slice(0, 12),
      credentialHash: await sha256Hex(credential),
      status: "active",
      issuedAt: now,
    });
    await ctx.db.patch(current._id, {
      status: "revoked",
      revokedAt: now,
      revocationReason: "credential_rotated",
      lastUsedAt: now,
    });
    await ctx.db.patch(device._id, { currentCredentialId: credentialId, updatedAt: now });
    return { credentialId, credential, issuedAt: now };
  },
});

// Additive two-phase protocol. Older paired hosts and the original rotate API keep working.
const credentialArgs = { deviceId: v.string(), credentialId: v.string(), credential: v.string() };

export const prepareRotation = mutation({
  args: { ...credentialArgs, nextCredentialId: v.string(), nextCredential: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { device } = await authenticateRuntimeHost(ctx, args);
    if (!/^credential_[a-f0-9-]{36}$/.test(args.nextCredentialId) || !/^nrh_[a-f0-9]{64}$/.test(args.nextCredential)) {
      throw runtimeHostError("VALIDATION_ERROR", "Invalid replacement credential");
    }
    const hash = await sha256Hex(args.nextCredential);
    const existing = await ctx.db.query("runtimeDeviceCredentials")
      .withIndex("by_credential_id", q => q.eq("credentialId", args.nextCredentialId)).unique();
    if (existing) {
      if (existing.runtimeDeviceId !== device._id || existing.credentialHash !== hash || existing.status !== "active") {
        throw runtimeHostError("UNAUTHORIZED", "Replacement credential does not match");
      }
      return null;
    }
    await ctx.db.insert("runtimeDeviceCredentials", {
      userId: device.userId, runtimeDeviceId: device._id, deviceId: device.deviceId,
      credentialId: args.nextCredentialId, credentialPrefix: args.nextCredential.slice(0, 12),
      credentialHash: hash, status: "active", issuedAt: Date.now(),
    });
    return null;
  },
});

export const finishRotation = mutation({
  args: { ...credentialArgs, previousCredentialId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { device } = await authenticateRuntimeHost(ctx, args);
    const previous = await ctx.db.query("runtimeDeviceCredentials")
      .withIndex("by_credential_id", q => q.eq("credentialId", args.previousCredentialId)).unique();
    if (!previous || previous.runtimeDeviceId !== device._id || previous.credentialId === args.credentialId) {
      throw runtimeHostError("UNAUTHORIZED", "Previous credential does not match this device");
    }
    const now = Date.now();
    if (previous.status === "active") await ctx.db.patch(previous._id, {
      status: "revoked", revokedAt: now, revocationReason: "credential_rotated", lastUsedAt: now,
    });
    await ctx.db.patch(device._id, { currentCredentialId: args.credentialId, updatedAt: now });
    return null;
  },
});
