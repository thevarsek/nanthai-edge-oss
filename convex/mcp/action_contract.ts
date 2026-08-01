import { v } from "convex/values";
import { encryptSecret, mcpCredentialSecretContext } from "../lib/secret_crypto";

export const mcpAuthMode = v.union(
  v.literal("none"),
  v.literal("bearer"),
  v.literal("api_key"),
  v.literal("oauth"),
);

export const mcpInvocationKind = v.union(
  v.literal("tool"),
  v.literal("prompt"),
  v.literal("resource"),
  v.literal("resource_template"),
);

export async function encryptedConnectionCredential(args: {
  userId: string;
  connectionId: string;
  issuerOrOrigin: string;
  secret: string;
}): Promise<string> {
  return await encryptSecret(args.secret, mcpCredentialSecretContext({
    userId: args.userId,
    connectionId: args.connectionId,
    issuerOrOrigin: args.issuerOrOrigin,
    field: "credentialValue",
  }));
}

export function invocationMethod(
  kind: "tool" | "prompt" | "resource" | "resource_template",
): string {
  if (kind === "tool") return "tools/call";
  if (kind === "prompt") return "prompts/get";
  return "resources/read";
}
