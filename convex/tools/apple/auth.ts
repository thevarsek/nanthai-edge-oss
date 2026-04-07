import { ConvexError } from "convex/values";
import { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";

export interface StoredAppleCalendarConnection {
  _id: string;
  userId: string;
  provider: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  email?: string;
  displayName?: string;
  status: string;
  connectedAt: number;
  lastUsedAt?: number;
  errorMessage?: string;
}

export async function getAppleCalendarCredentials(
  ctx: ActionCtx,
  userId: string,
): Promise<{
  connection: StoredAppleCalendarConnection;
  username: string;
  appSpecificPassword: string;
}> {
  const connection = (await ctx.runQuery(
    internal.oauth.apple_calendar.getConnectionInternal,
    { userId },
  )) as StoredAppleCalendarConnection | null;

  if (!connection) {
    throw new ConvexError({
      code: "INTEGRATION_NOT_CONNECTED" as const,
      message: "No Apple Calendar account connected. Ask the user to connect Apple Calendar in Settings → Connected Accounts.",
    });
  }

  if (connection.status !== "active") {
    throw new ConvexError({
      code: "INTEGRATION_NOT_CONNECTED" as const,
      message: `Apple Calendar connection is ${connection.status}. Ask the user to reconnect Apple Calendar in Settings.`,
    });
  }

  if (!connection.email || !connection.accessToken) {
    throw new ConvexError({
      code: "INTEGRATION_NOT_CONNECTED" as const,
      message: "Apple Calendar credentials are incomplete. Ask the user to reconnect Apple Calendar in Settings.",
    });
  }

  return {
    connection,
    username: connection.email,
    appSpecificPassword: connection.accessToken,
  };
}
