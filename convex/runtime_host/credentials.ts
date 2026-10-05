import { mutation } from "../_generated/server";
import { v } from "convex/values";
import {
  authenticateRuntimeHost,
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
