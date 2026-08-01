import { ConvexError } from "convex/values";

export const NOTION_OAUTH_TOKEN_URL = "https://api.notion.com/v1/oauth/token";
export const NOTION_OAUTH_REVOKE_URL = "https://api.notion.com/v1/oauth/revoke";
export const NOTION_OAUTH_VERSION = "2026-03-11";

type NotionOAuthClientConfig = {
  clientId: string;
  clientSecret: string;
  authorization: string;
};

export function getNotionOAuthClientConfig(): NotionOAuthClientConfig {
  const clientId = process.env.NOTION_CLIENT_ID?.trim();
  const clientSecret = process.env.NOTION_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new ConvexError({
      code: "CONFIG_ERROR" as const,
      message: "Notion OAuth is not configured. Set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET environment variables.",
    });
  }

  return {
    clientId,
    clientSecret,
    authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
  };
}

export function notionOAuthHeaders(
  config: NotionOAuthClientConfig,
): Record<string, string> {
  return {
    Authorization: config.authorization,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Notion-Version": NOTION_OAUTH_VERSION,
  };
}
