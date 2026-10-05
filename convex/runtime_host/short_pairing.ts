import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { mutation } from "../_generated/server";
import { claimPairingHandler, pairingGrant } from "./pairing";
import { PAIRING_PROTOCOL_VERSION } from "./protocol_common";
import { runtimeHostError, sha256Hex } from "./security";

export async function claimShortPairingHandler(ctx: MutationCtx,
  args: Omit<Parameters<typeof claimPairingHandler>[1], "pairingId" | "oneTimeCode"> & { shortCode: string }) {
  const code = args.shortCode.trim().replace(/-/g, "").toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(code)) throw runtimeHostError("PAIRING_INVALID", "Enter the complete pairing code from NanthAI.");
  const oneTimeCode = `nrp_${code}`;
  const codeHash = await sha256Hex(oneTimeCode);
  const pairing = await ctx.db.query("runtimePairingRequests")
    .withIndex("by_code_hash", (query) => query.eq("codeHash", codeHash)).unique();
  return await claimPairingHandler(ctx, { ...args, pairingId: pairing?.pairingId ?? "invalid", oneTimeCode });
}

export const claimShortPairing = mutation({
  args: { protocolVersion: v.literal(PAIRING_PROTOCOL_VERSION), shortCode: v.string(),
    hostNonce: v.string(), hostPublicKey: v.string(),
    device: v.object({ displayName: v.string(), hostVersion: v.string(),
      platform: v.object({ operatingSystem: v.union(v.literal("macos"), v.literal("windows"), v.literal("linux")),
        architecture: v.union(v.literal("arm64"), v.literal("x64")), release: v.string() }) }) },
  returns: pairingGrant,
  handler: (ctx, args) => claimShortPairingHandler(ctx, { shortCode: args.shortCode,
    hostNonce: args.hostNonce, hostPublicKey: args.hostPublicKey, displayName: args.device.displayName,
    operatingSystem: args.device.platform.operatingSystem, architecture: args.device.platform.architecture,
    platformRelease: args.device.platform.release, hostVersion: args.device.hostVersion }),
});
