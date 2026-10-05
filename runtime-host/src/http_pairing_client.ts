import { generateKeyPairSync, randomBytes } from "node:crypto";
import { release } from "node:os";

import type {
  DeviceCredential,
  PairingClient,
  PairingRequest,
} from "./control_plane.ts";
import { runtimeArchitecture, runtimeOperatingSystem } from "./host_platform.ts";
import { HttpJsonClient, type FetchImplementation } from "./http_json_client.ts";
import {
  PAIRING_PROTOCOL_VERSION,
  PairingGrantSchema,
} from "./http_runtime_contract.ts";

export type PairingIdentity = { hostNonce: string; hostPublicKey: string };
export type HttpPairingClientOptions = {
  controlPlaneUrl: string;
  hostVersion: string;
  fetch?: FetchImplementation;
  operatingSystemRelease?: () => string;
  createIdentity?: () => PairingIdentity;
};

export class HttpPairingClient implements PairingClient {
  private readonly operatingSystemRelease: () => string;
  private readonly createIdentity: () => PairingIdentity;

  constructor(private readonly options: HttpPairingClientOptions) {
    this.operatingSystemRelease = options.operatingSystemRelease ?? release;
    this.createIdentity = options.createIdentity ?? createPairingIdentity;
  }

  async pair(request: PairingRequest): Promise<DeviceCredential> {
    const controlPlaneUrl = request.controlPlaneUrl ?? this.options.controlPlaneUrl;
    if (!controlPlaneUrl) throw new Error("Use the pairing command from NanthAI, including --server, or set NANTHAI_CONTROL_PLANE_URL.");
    const client = new HttpJsonClient(controlPlaneUrl, {
      ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
    });
    const identity = this.createIdentity();
    const grant = await client.post(
      request.shortCode ? "/runtime-host/v1/pairing/claim-code" : "/runtime-host/v1/pairing/claim",
      {
        protocolVersion: PAIRING_PROTOCOL_VERSION,
        ...(request.shortCode ? { shortCode: request.oneTimeCode } : {
          pairingId: request.pairingId, oneTimeCode: request.oneTimeCode }),
        ...identity,
        device: {
          displayName: request.hostname,
          platform: {
            operatingSystem: runtimeOperatingSystem(request.platform),
            architecture: runtimeArchitecture(request.architecture),
            release: this.operatingSystemRelease(),
          },
          hostVersion: this.options.hostVersion,
        },
      },
      PairingGrantSchema,
    );
    if (!request.shortCode && grant.pairingId !== request.pairingId) {
      throw new Error("Pairing grant does not match the claimed pairing session");
    }
    return {
      deviceId: grant.deviceId,
      credentialId: grant.credentialId,
      controlPlaneUrl,
      credential: grant.credential,
    };
  }
}

function createPairingIdentity(): PairingIdentity {
  const { publicKey } = generateKeyPairSync("ed25519");
  return {
    hostNonce: randomBytes(32).toString("base64url"),
    hostPublicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}
