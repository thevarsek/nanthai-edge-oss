import { MutationCtx, QueryCtx } from "../_generated/server";
import { Doc } from "../_generated/dataModel";
import { isUserPro } from "../preferences/entitlements";

export type CapabilityName = Doc<"userCapabilities">["capability"];
export type CapabilitySource = Doc<"userCapabilities">["source"];
type CapabilityCtx = QueryCtx | MutationCtx;

export interface AccountCapabilities {
  capabilities: CapabilityName[];
  isPro: boolean;
  hasSandboxRuntime: boolean;
  hasMcpRuntime: boolean;
}

function dedupeCapabilities(values: CapabilityName[]): CapabilityName[] {
  return Array.from(new Set(values));
}

async function queryManualCapabilityGrants(
  ctx: CapabilityCtx,
  userId: string,
): Promise<Array<Doc<"userCapabilities">>> {
  try {
    const result = ctx.db
      .query("userCapabilities")
      .withIndex("by_user", (q) => q.eq("userId", userId).eq("status", "active"));
    if (typeof (result as { collect?: unknown }).collect === "function") {
      return await (result as { collect: () => Promise<Array<Doc<"userCapabilities">>> }).collect();
    }
    if (typeof (result as { first?: unknown }).first === "function") {
      const first = await (result as { first: () => Promise<Doc<"userCapabilities"> | null> }).first();
      return first ? [first] : [];
    }
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("Unexpected table query: userCapabilities") ||
      message.includes("collect is not a function")
    ) {
      return [];
    }
    throw error;
  }
}

export async function listActiveCapabilities(
  ctx: CapabilityCtx,
  userId: string,
): Promise<CapabilityName[]> {
  const now = Date.now();
  const capabilities: CapabilityName[] = [];

  if (await isUserPro(ctx as QueryCtx | MutationCtx, userId)) {
    capabilities.push("pro");
  }

  const grants = await queryManualCapabilityGrants(ctx, userId);

  for (const grant of grants) {
    if (grant.capability === "pro") {
      continue;
    }
    if (grant.expiresAt !== undefined && grant.expiresAt <= now) {
      continue;
    }
    capabilities.push(grant.capability);
  }

  return dedupeCapabilities(capabilities);
}

export async function hasCapability(
  ctx: CapabilityCtx,
  userId: string,
  capability: CapabilityName,
): Promise<boolean> {
  if (capability === "pro") {
    return await isUserPro(ctx, userId);
  }
  const capabilities = await listActiveCapabilities(ctx, userId);
  return capabilities.includes(capability);
}

export async function getAccountCapabilities(
  ctx: CapabilityCtx,
  userId: string,
): Promise<AccountCapabilities> {
  const capabilities = await listActiveCapabilities(ctx, userId);
  return {
    capabilities,
    isPro: capabilities.includes("pro"),
    hasSandboxRuntime: capabilities.includes("sandboxRuntime"),
    hasMcpRuntime: capabilities.includes("mcpRuntime"),
  };
}
