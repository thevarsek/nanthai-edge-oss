import { UriTemplate } from "@modelcontextprotocol/server";

export type RemoteMcpContentKind = "prompt" | "resource" | "resource_template";

export type RemoteMcpContentItem = {
  connectionId: string;
  stableKey: string;
  serverName: string;
  kind: RemoteMcpContentKind;
  displayName: string;
  description?: string;
  uri?: string;
  uriTemplate?: string;
  arguments?: unknown;
};

export type RemoteMcpArgumentField = {
  name: string;
  label: string;
  required: boolean;
  description?: string;
};

const credentialTerms = [
  "password",
  "passcode",
  "secret",
  "token",
  "credential",
  "api key",
  "private key",
  "login code",
];

export function argumentLooksSecret(field: RemoteMcpArgumentField): boolean {
  const value = `${field.name} ${field.label} ${field.description ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  const compact = value.replaceAll(" ", "");
  return credentialTerms.some((term) =>
    value.includes(term) || compact.includes(term.replaceAll(" ", "")));
}

export function argumentNames(item: RemoteMcpContentItem): RemoteMcpArgumentField[] {
  if (Array.isArray(item.arguments)) {
    return item.arguments.flatMap((value) => {
      if (typeof value !== "object" || value === null) return [];
      const row = value as Record<string, unknown>;
      return typeof row.name === "string"
        ? [{
            name: row.name,
            label: typeof row.title === "string" ? row.title : row.name,
            required: row.required === true,
            description: typeof row.description === "string" ? row.description : undefined,
          }]
        : [];
    });
  }
  if (!item.uriTemplate) return [];
  try {
    return new UriTemplate(item.uriTemplate).variableNames.map((name) => ({
      name,
      label: name,
      required: true,
    }));
  } catch {
    return [];
  }
}

export function resolvedUri(
  item: RemoteMcpContentItem,
  values: Record<string, string>,
): string | undefined {
  if (item.kind === "resource") return item.uri;
  if (!item.uriTemplate) return undefined;
  try {
    return new UriTemplate(item.uriTemplate).expand(values);
  } catch {
    return undefined;
  }
}
