import { z } from "zod";
import {
  AdapterCapabilitiesSchema,
} from "./protocol_adapter";
import {
  boundedString,
  IdentifierSchema,
  LabelSchema,
  PAIRING_PROTOCOL_VERSION,
  TimestampSchema,
} from "./protocol_common";

export const RuntimePlatformSchema = z.strictObject({
  operatingSystem: z.enum(["macos", "windows", "linux"]),
  architecture: z.enum(["arm64", "x64"]),
  release: boundedString(200),
});

export const PairingInitiationSchema = z.strictObject({
  protocolVersion: z.literal(PAIRING_PROTOCOL_VERSION),
  pairingId: IdentifierSchema,
  oneTimeCode: boundedString(128),
  expiresAt: TimestampSchema,
  pairingCommand: boundedString(1_000).optional(),
  pairingCode: boundedString(32).optional(),
  serverOrigin: z.string().url().optional(),
});

export const PairingClaimSchema = z.strictObject({
  protocolVersion: z.literal(PAIRING_PROTOCOL_VERSION),
  pairingId: IdentifierSchema,
  oneTimeCode: boundedString(128),
  hostNonce: boundedString(512),
  hostPublicKey: boundedString(8_192),
  device: z.strictObject({
    displayName: LabelSchema,
    platform: RuntimePlatformSchema,
    hostVersion: IdentifierSchema,
  }),
});

export const ShortPairingClaimSchema = PairingClaimSchema.omit({ pairingId: true, oneTimeCode: true })
  .extend({ shortCode: z.string().min(16).max(32) });

export const PairingGrantSchema = z.strictObject({
  protocolVersion: z.literal(PAIRING_PROTOCOL_VERSION),
  pairingId: IdentifierSchema,
  deviceId: IdentifierSchema,
  credentialId: IdentifierSchema,
  credential: boundedString(8_192),
  issuedAt: TimestampSchema,
});

export const RuntimePresenceSchema = z.strictObject({
  protocolVersion: z.literal(PAIRING_PROTOCOL_VERSION),
  deviceId: IdentifierSchema,
  credentialId: IdentifierSchema,
  presenceSessionId: IdentifierSchema,
  owner: z.enum(["foreground_cli", "tray"]),
  connectedAt: TimestampSchema,
  heartbeatAt: TimestampSchema,
  hostVersion: IdentifierSchema,
  platform: RuntimePlatformSchema,
  adapters: z.array(z.strictObject({
    adapterId: IdentifierSchema,
    adapterVersion: IdentifierSchema,
    authState: z.enum(["ready", "signed_out", "unavailable"]),
    capabilities: AdapterCapabilitiesSchema,
  })).max(100),
}).superRefine((presence, context) => {
  presence.adapters.forEach((adapter, index) => {
    if (adapter.adapterId !== adapter.capabilities.adapterId
      || adapter.adapterVersion !== adapter.capabilities.adapterVersion) {
      context.addIssue({
        code: "custom",
        path: ["adapters", index, "capabilities"],
        message: "Presence adapter identity must match its capability snapshot",
      });
    }
  });
});

export const PairingRevocationSchema = z.strictObject({
  protocolVersion: z.literal(PAIRING_PROTOCOL_VERSION),
  deviceId: IdentifierSchema,
  credentialId: IdentifierSchema,
  revokedAt: TimestampSchema,
  reason: boundedString(2_000),
});

export type RuntimePlatform = z.infer<typeof RuntimePlatformSchema>;
export type PairingInitiation = z.infer<typeof PairingInitiationSchema>;
export type PairingClaim = z.infer<typeof PairingClaimSchema>;
export type PairingGrant = z.infer<typeof PairingGrantSchema>;
export type RuntimePresence = z.infer<typeof RuntimePresenceSchema>;
export type PairingRevocation = z.infer<typeof PairingRevocationSchema>;
