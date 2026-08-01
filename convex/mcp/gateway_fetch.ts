"use node";

import type { FetchLike } from "@modelcontextprotocol/client";

function requestBody(body: BodyInit | null | undefined): string | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString("utf8");
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf8");
  }
  throw new Error("MCP request body type is unsupported.");
}

export function createMcpGatewayFetch(args: {
  gatewayUrl: string;
  sharedSecret: string;
  apiKeyHeaderName?: string;
}): FetchLike {
  return async (input, init) => {
    const targetUrl = typeof input === "string" ? input : input.toString();
    const requestHeaders = new Headers(init?.headers);
    const headers: Record<string, string> = {};
    requestHeaders.forEach((value, name) => {
      headers[name] = value;
    });
    const response = await fetch(args.gatewayUrl, {
      method: "POST",
      redirect: "manual",
      signal: init?.signal ?? undefined,
      headers: {
        "content-type": "application/json",
        "x-nanthai-egress-key": args.sharedSecret,
      },
      body: JSON.stringify({
        url: targetUrl,
        method: (init?.method ?? "GET").toUpperCase(),
        headers,
        body: requestBody(init?.body),
        apiKeyHeaderName: args.apiKeyHeaderName,
      }),
    });
    return response;
  };
}

export function createDefaultMcpGatewayFetch(apiKeyHeaderName?: string): FetchLike {
  const gatewayUrl = process.env.MCP_EGRESS_URL?.trim();
  const sharedSecret = process.env.MCP_EGRESS_SHARED_SECRET?.trim();
  if (!gatewayUrl || !sharedSecret) throw new Error("MCP outbound egress is not configured.");
  return createMcpGatewayFetch({ gatewayUrl, sharedSecret, apiKeyHeaderName });
}
