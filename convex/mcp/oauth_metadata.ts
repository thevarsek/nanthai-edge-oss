"use node";

import {
  checkResourceAllowed,
  discoverAuthorizationServerMetadata,
  discoverOAuthServerInfo,
  type AuthorizationServerMetadata,
} from "@modelcontextprotocol/client";
import { createDefaultMcpGatewayFetch } from "./gateway_fetch";
import { MCP_PROTOCOL_VERSION, safeMcpEndpoint } from "./policy";

function normalizeMetadata(
  issuer: string,
  resource: string,
  metadata: AuthorizationServerMetadata,
): {
  issuer: string;
  resource: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  scopesSupported: string[];
} {
  const metadataRecord = metadata as unknown as Record<string, unknown>;
  if (typeof metadata.authorization_endpoint !== "string" || typeof metadata.token_endpoint !== "string") {
    throw new Error("MCP_OAUTH_METADATA_INCOMPLETE");
  }
  const authorizationEndpoint = safeMcpEndpoint(metadata.authorization_endpoint).endpoint;
  const tokenEndpoint = safeMcpEndpoint(metadata.token_endpoint).endpoint;
  const revocationEndpoint = typeof metadataRecord.revocation_endpoint === "string"
    ? safeMcpEndpoint(metadataRecord.revocation_endpoint).endpoint
    : undefined;
  const methods = Array.isArray(metadata.code_challenge_methods_supported)
    ? metadata.code_challenge_methods_supported
    : [];
  if (!methods.includes("S256")) throw new Error("MCP_OAUTH_PKCE_UNSUPPORTED");
  const scopesSupported = Array.isArray(metadata.scopes_supported)
    ? metadata.scopes_supported.filter((scope): scope is string => typeof scope === "string").slice(0, 50)
    : [];
  return {
    issuer: issuer.replace(/\/$/, ""),
    resource,
    authorizationEndpoint,
    tokenEndpoint,
    revocationEndpoint,
    scopesSupported,
  };
}

export async function fetchMcpOAuthMetadata(args: {
  endpoint: string;
  issuer?: string;
}): Promise<ReturnType<typeof normalizeMetadata>> {
  const fetchFn = createDefaultMcpGatewayFetch();
  if (args.issuer?.trim()) {
    const issuer = safeMcpEndpoint(args.issuer).endpoint.replace(/\/$/, "");
    const metadata = await discoverAuthorizationServerMetadata(issuer, {
      fetchFn,
      protocolVersion: MCP_PROTOCOL_VERSION,
    });
    if (!metadata) throw new Error("MCP_OAUTH_METADATA_FAILED");
    return normalizeMetadata(issuer, safeMcpEndpoint(args.endpoint).endpoint, metadata);
  }
  const discovered = await discoverOAuthServerInfo(args.endpoint, { fetchFn });
  if (!discovered.authorizationServerMetadata) throw new Error("MCP_OAUTH_METADATA_FAILED");
  const resource = typeof discovered.resourceMetadata?.resource === "string"
    ? safeMcpEndpoint(discovered.resourceMetadata.resource).endpoint
    : safeMcpEndpoint(args.endpoint).endpoint;
  if (!checkResourceAllowed({
    requestedResource: safeMcpEndpoint(args.endpoint).endpoint,
    configuredResource: resource,
  })) {
    throw new Error("MCP_OAUTH_RESOURCE_MISMATCH");
  }
  return normalizeMetadata(
    discovered.authorizationServerUrl,
    resource,
    discovered.authorizationServerMetadata,
  );
}
