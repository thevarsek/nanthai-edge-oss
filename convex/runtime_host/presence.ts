import { wakeLocalCollaboration } from "../collaboration/runtime_wake";
import { acknowledgeStoppedRuntimeHost } from "./host_stop_receipt";
import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { mutation } from "../_generated/server";
import { PAIRING_PROTOCOL_VERSION } from "./protocol_common";
import { RuntimePresenceSchema } from "./protocol_pairing";
import {
  authenticateRuntimeHost,
  runtimeHostError,
} from "./security";
import { provisionStarterPersona } from "./starter_persona";
import { wakeRuntimeDeviceWaits } from "./device_wait";

// Hosts beat every 60s; the lease tolerates one missed beat plus network delay.
const PRESENCE_LEASE_MS = 150_000;

const operatingSystem = v.union(
  v.literal("macos"),
  v.literal("windows"),
  v.literal("linux"),
);
const architecture = v.union(v.literal("arm64"), v.literal("x64"));

const adapterCapabilities = v.object({
  protocolVersion: v.string(),
  adapterId: v.string(),
  adapterVersion: v.string(),
  transport: v.union(
    v.literal("sdk"),
    v.literal("stdio_jsonrpc"),
    v.literal("stdio_jsonl"),
    v.literal("acp"),
  ),
  inputModalities: v.array(v.string()),
  eventTypes: v.array(v.string()),
  operations: v.object({
    listModels: v.boolean(),
    cancel: v.boolean(),
    resume: v.boolean(),
    permissionResponse: v.boolean(),
    inputResponse: v.boolean(),
  }),
  nanthaiSourceCitations: v.optional(v.boolean()),
  nanthaiCollaborationWork: v.optional(v.boolean()),
  adapterNative: v.object({
    tools: v.boolean(),
    plugins: v.boolean(),
    mcpServers: v.boolean(),
    skills: v.boolean(),
    webSearch: v.optional(v.boolean()),
  }),
});

const presenceAdapter = v.object({
  adapterId: v.string(),
  adapterVersion: v.string(),
  authState: v.union(
    v.literal("ready"),
    v.literal("signed_out"),
    v.literal("unavailable"),
  ),
  capabilities: adapterCapabilities,
});

const credentialArgs = {
  deviceId: v.string(),
  credentialId: v.string(),
  credential: v.string(),
};

export async function heartbeatPresenceHandler(
  ctx: MutationCtx,
  args: {
    deviceId: string;
    credentialId: string;
    credential: string;
    presenceSessionId: string;
    owner: "foreground_cli" | "tray";
    connectedAt: number;
    heartbeatAt: number;
    hostVersion: string;
    platform: {
      operatingSystem: "macos" | "windows" | "linux";
      architecture: "arm64" | "x64";
      release: string;
    };
    adapters: Array<{
      adapterId: string;
      adapterVersion: string;
      authState: "ready" | "signed_out" | "unavailable";
      capabilities: {
        protocolVersion: string;
        adapterId: string;
        adapterVersion: string;
        transport: "sdk" | "stdio_jsonrpc" | "stdio_jsonl" | "acp";
        inputModalities: string[];
        eventTypes: string[];
        operations: {
          listModels: boolean;
          cancel: boolean;
          resume: boolean;
          permissionResponse: boolean;
          inputResponse: boolean;
        };
        nanthaiSourceCitations?: boolean;
        nanthaiCollaborationWork?: boolean;
        adapterNative: {
          tools: boolean;
          plugins: boolean;
          mcpServers: boolean;
          skills: boolean;
          webSearch?: boolean;
        };
      };
    }>;
    now?: number;
  },
): Promise<{ presenceId: string; serverTime: number; expiresAt: number }> {
  const parsed = RuntimePresenceSchema.safeParse({
    protocolVersion: PAIRING_PROTOCOL_VERSION,
    deviceId: args.deviceId,
    credentialId: args.credentialId,
    presenceSessionId: args.presenceSessionId,
    owner: args.owner,
    connectedAt: args.connectedAt,
    heartbeatAt: args.heartbeatAt,
    hostVersion: args.hostVersion,
    platform: args.platform,
    adapters: args.adapters,
  });
  if (!parsed.success) {
    throw runtimeHostError("VALIDATION_ERROR", "Runtime presence payload is invalid");
  }
  const { credential, device } = await authenticateRuntimeHost(ctx, args);
  const now = args.now ?? Date.now();
  const expiresAt = now + PRESENCE_LEASE_MS;
  const active = await ctx.db
    .query("runtimeDevicePresences")
    .withIndex("by_device_status", (query) =>
      query.eq("runtimeDeviceId", device._id).eq("status", "online"),
    )
    .collect();
  // A sleeping/disconnected process resumes the same session after lease expiry.
  const sameSession = await ctx.db
    .query("runtimeDevicePresences")
    .withIndex("by_device_session", (query) =>
      query.eq("runtimeDeviceId", device._id)
        .eq("presenceSessionId", args.presenceSessionId),
    )
    .unique();
  const competing = active.find(
    (presence) =>
      presence.presenceSessionId !== args.presenceSessionId
      && presence.expiresAt > now,
  );
  if (competing) {
    throw runtimeHostError(
      "RUNTIME_HOST_ALREADY_ONLINE",
      "This machine already has an active Runtime Host",
    );
  }
  for (const expired of active) {
    if (expired._id === sameSession?._id || expired.expiresAt > now) continue;
    await ctx.db.patch(expired._id, {
      status: "superseded",
      disconnectedAt: now,
      disconnectReason: "presence_expired",
    });
  }
  const presencePatch = {
    status: "online" as const,
    disconnectedAt: undefined,
    disconnectReason: undefined,
    credentialId: credential.credentialId,
    owner: args.owner,
    heartbeatAt: now,
    expiresAt,
    hostVersion: parsed.data.hostVersion,
    operatingSystem: parsed.data.platform.operatingSystem,
    architecture: parsed.data.platform.architecture,
    platformRelease: parsed.data.platform.release,
    adapters: parsed.data.adapters,
  };
  const presenceId = sameSession?._id ?? await ctx.db.insert("runtimeDevicePresences", {
    userId: device.userId,
    runtimeDeviceId: device._id,
    deviceId: device.deviceId,
    presenceSessionId: parsed.data.presenceSessionId,
    connectedAt: now,
    ...presencePatch,
  });
  if (sameSession) await ctx.db.patch(sameSession._id, presencePatch);
  await ctx.db.patch(credential._id, { lastUsedAt: now });
  await ctx.db.patch(device._id, {
    currentPresenceId: presenceId,
    lastSeenAt: now,
    hostVersion: parsed.data.hostVersion,
    operatingSystem: parsed.data.platform.operatingSystem,
    architecture: parsed.data.platform.architecture,
    platformRelease: parsed.data.platform.release,
    updatedAt: now,
  });
  if (parsed.data.adapters.some((adapter) => ["codex", "pi"].includes(adapter.adapterId) && adapter.authState === "ready")) {
    await provisionStarterPersona(ctx, device, now);
    await wakeRuntimeDeviceWaits(ctx, device, parsed.data.adapters, now);
    await wakeLocalCollaboration(ctx, device.userId, device.deviceId);
  }
  return { presenceId: String(presenceId), serverTime: now, expiresAt };
}

export const heartbeat = mutation({
  args: {
    ...credentialArgs,
    protocolVersion: v.literal(PAIRING_PROTOCOL_VERSION),
    presenceSessionId: v.string(),
    owner: v.union(v.literal("foreground_cli"), v.literal("tray")),
    connectedAt: v.number(),
    heartbeatAt: v.number(),
    hostVersion: v.string(),
    platform: v.object({ operatingSystem, architecture, release: v.string() }),
    adapters: v.array(presenceAdapter),
  },
  returns: v.object({ presenceId: v.string(), serverTime: v.number(), expiresAt: v.number() }),
  handler: async (ctx, args) => await heartbeatPresenceHandler(ctx, args),
});

export const disconnect = mutation({
  args: { ...credentialArgs, presenceSessionId: v.string(), reason: v.string(), executionStopped: v.optional(v.boolean()) },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (args.executionStopped) return await acknowledgeStoppedRuntimeHost(ctx, args);
    const { credential, device } = await authenticateRuntimeHost(ctx, args);
    const presence = await ctx.db
      .query("runtimeDevicePresences")
      .withIndex("by_device_session", (query) =>
        query.eq("runtimeDeviceId", device._id)
          .eq("presenceSessionId", args.presenceSessionId),
      )
      .unique();
    if (!presence || presence.status !== "online") return false;
    const now = Date.now();
    await ctx.db.patch(presence._id, {
      status: "offline",
      disconnectedAt: now,
      disconnectReason: args.reason.slice(0, 500),
    });
    await ctx.db.patch(credential._id, { lastUsedAt: now });
    if (device.currentPresenceId === presence._id) {
      await ctx.db.patch(device._id, { currentPresenceId: undefined, updatedAt: now });
    }
    return true;
  },
});
