import assert from "node:assert/strict";
import test from "node:test";

import { getAccountCapabilities, hasCapability, listActiveCapabilities } from "../capabilities/shared";

type EntitlementDoc = {
  userId: string;
  status: "active" | "revoked" | "refunded" | "expired";
};

type CapabilityDoc = {
  userId: string;
  capability: "pro" | "sandboxRuntime" | "mcpRuntime";
  status: "active" | "revoked";
  expiresAt?: number;
};

function buildCtx({
  entitlement,
  grants,
}: {
  entitlement: EntitlementDoc | null;
  grants: CapabilityDoc[];
}) {
  return {
    db: {
      query: (table: string) => ({
        withIndex: (
          index: string,
          apply: (q: {
            eq: (_field: string, _value: string) => {
              eq: (_field2: string, _value2: string) => unknown;
            };
          }) => unknown,
        ) => {
          let userId = "";
          let status: string | null = null;
          apply({
            eq: (_field: string, value: string) => {
              userId = value;
              return {
                eq: (_field2: string, value2: string) => {
                  status = value2;
                  return {};
                },
              };
            },
          });

          if (table === "purchaseEntitlements" && index === "by_user_status") {
            return {
              first: async () => (
                entitlement?.userId === userId && entitlement.status === status
                  ? entitlement
                  : null
              ),
            };
          }

          if (table === "userCapabilities" && index === "by_user") {
            const matching = grants.filter((grant) => grant.userId === userId && grant.status === status);
            return {
              collect: async () => matching,
            };
          }

          return {
            first: async () => null,
            collect: async () => [],
          };
        },
      }),
    },
  } as any;
}

test("manual pro capability does not unlock Pro without an active entitlement", async () => {
  const ctx = buildCtx({
    entitlement: null,
    grants: [
      { userId: "user_1", capability: "pro", status: "active" },
      { userId: "user_1", capability: "sandboxRuntime", status: "active" },
    ],
  });

  assert.deepEqual(await listActiveCapabilities(ctx, "user_1"), ["sandboxRuntime"]);
  assert.equal(await hasCapability(ctx, "user_1", "pro"), false);

  const account = await getAccountCapabilities(ctx, "user_1");
  assert.equal(account.isPro, false);
  assert.equal(account.hasSandboxRuntime, true);
  assert.deepEqual(account.capabilities, ["sandboxRuntime"]);
});

test("active entitlement contributes Pro while runtime capabilities still come from userCapabilities", async () => {
  const ctx = buildCtx({
    entitlement: { userId: "user_1", status: "active" },
    grants: [
      { userId: "user_1", capability: "sandboxRuntime", status: "active" },
      { userId: "user_1", capability: "mcpRuntime", status: "active" },
    ],
  });

  assert.deepEqual(
    await listActiveCapabilities(ctx, "user_1"),
    ["pro", "sandboxRuntime", "mcpRuntime"],
  );
  assert.equal(await hasCapability(ctx, "user_1", "pro"), true);

  const account = await getAccountCapabilities(ctx, "user_1");
  assert.equal(account.isPro, true);
  assert.equal(account.hasSandboxRuntime, true);
  assert.equal(account.hasMcpRuntime, true);
});
