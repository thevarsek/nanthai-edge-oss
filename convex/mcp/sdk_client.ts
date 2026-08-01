"use node";

import {
  Client,
  StreamableHTTPClientTransport,
  type AuthProvider,
  type Tool,
} from "@modelcontextprotocol/client";
import { createDefaultMcpGatewayFetch } from "./gateway_fetch";
import { MCP_PROTOCOL_VERSION } from "./policy";

export interface McpConnectionCredential {
  bearerToken?: string;
  apiKeyHeader?: string;
  apiKeyValue?: string;
}

export async function openMcpClient(args: {
  endpoint: string;
  cachePartition: string;
  credential?: McpConnectionCredential;
}): Promise<{ client: Client; close: () => Promise<void> }> {
  const customHeaders: Record<string, string> = {};
  if (args.credential?.apiKeyHeader && args.credential.apiKeyValue) {
    customHeaders[args.credential.apiKeyHeader] = args.credential.apiKeyValue;
  }
  const authProvider: AuthProvider | undefined = args.credential?.bearerToken
    ? { token: async () => args.credential?.bearerToken }
    : undefined;
  const transport = new StreamableHTTPClientTransport(new URL(args.endpoint), {
    authProvider,
    requestInit: { headers: customHeaders, redirect: "manual" },
    fetch: createDefaultMcpGatewayFetch(args.credential?.apiKeyHeader),
    onInsufficientScope: "throw",
    reconnectionOptions: {
      maxReconnectionDelay: 1000,
      initialReconnectionDelay: 250,
      reconnectionDelayGrowFactor: 1,
      maxRetries: 0,
    },
  });
  const client = new Client(
    { name: "NanthAI", version: "1.0.0" },
    {
      capabilities: {
        elicitation: { form: {}, url: {} },
        extensions: { "io.modelcontextprotocol/tasks": {} },
      },
      versionNegotiation: {
        mode: { pin: MCP_PROTOCOL_VERSION },
        probe: { timeoutMs: 15_000, maxRetries: 0 },
      },
      inputRequired: { autoFulfill: false, maxRounds: 8 },
      listMaxPages: 16,
      cachePartition: args.cachePartition,
      defaultCacheTtlMs: 0,
    },
  );
  await client.connect(transport, { timeout: 20_000, maxTotalTimeout: 25_000 });
  if (
    client.getProtocolEra() !== "modern"
    || client.getNegotiatedProtocolVersion() !== MCP_PROTOCOL_VERSION
    || transport.sessionId
  ) {
    await client.close();
    throw new Error("MCP server did not negotiate the required stateless protocol.");
  }
  return { client, close: async () => await client.close() };
}

export async function loadMcpCatalog(client: Client): Promise<{
  tools: Tool[];
  prompts: Awaited<ReturnType<Client["listPrompts"]>>["prompts"];
  resources: Awaited<ReturnType<Client["listResources"]>>["resources"];
  resourceTemplates: Awaited<ReturnType<Client["listResourceTemplates"]>>["resourceTemplates"];
}> {
  const [tools, prompts, resources, templates] = await Promise.all([
    client.listTools(undefined, { timeout: 20_000, cacheMode: "refresh" }),
    client.listPrompts(undefined, { timeout: 20_000, cacheMode: "refresh" }),
    client.listResources(undefined, { timeout: 20_000, cacheMode: "refresh" }),
    client.listResourceTemplates(undefined, { timeout: 20_000, cacheMode: "refresh" }),
  ]);
  return {
    tools: tools.tools,
    prompts: prompts.prompts,
    resources: resources.resources,
    resourceTemplates: templates.resourceTemplates,
  };
}
