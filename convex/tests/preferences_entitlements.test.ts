import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import { requirePro } from "../lib/auth";
import { isUserPro } from "../preferences/entitlements";
import { checkProStatus } from "../preferences/queries";

type EntitlementDoc = {
  userId: string;
  status: "active" | "revoked" | "refunded" | "expired";
};

function buildCtx({
  entitlement,
}: {
  entitlement: EntitlementDoc | null;
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
          let queriedStatus: string | null = null;
          apply({
            eq: (_field: string, _value: string) => ({
              eq: (field2: string, value2: string) => {
                if (field2 === "status") {
                  queriedStatus = value2;
                }
                return {};
              },
            }),
          });
          return {
            first: async () => {
              if (table === "purchaseEntitlements" && index === "by_user_status") {
                if (entitlement?.status === queriedStatus) {
                  return entitlement;
                }
                return null;
              }
              return null;
            },
          };
        },
      }),
    },
  } as any;
}

test("isUserPro returns true when active entitlement exists", async () => {
  const ctx = buildCtx({
    entitlement: { userId: "user_1", status: "active" },
  });

  const result = await isUserPro(ctx, "user_1");
  assert.equal(result, true);
});

test("requirePro allows active entitlement", async () => {
  const ctx = buildCtx({
    entitlement: { userId: "user_1", status: "active" },
  });

  await assert.doesNotReject(async () => {
    await requirePro(ctx, "user_1");
  });
});

test("checkProStatus returns true for active entitlement", async () => {
  const ctx = buildCtx({
    entitlement: { userId: "user_1", status: "active" },
  });

  const result = await (checkProStatus as any)._handler(ctx, { userId: "user_1" });
  assert.equal(result, true);
});

test("isUserPro returns false when no entitlement exists", async () => {
  const ctx = buildCtx({
    entitlement: null,
  });

  const result = await isUserPro(ctx, "user_1");
  assert.equal(result, false);
});

test("requirePro throws PRO_REQUIRED when no entitlement exists", async () => {
  const ctx = buildCtx({
    entitlement: null,
  });

  await assert.rejects(
    requirePro(ctx, "user_1"),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      return (error as ConvexError<any>).data?.code === "PRO_REQUIRED";
    },
  );
});

test("isUserPro returns false for non-active entitlement statuses", async () => {
  for (const status of ["revoked", "refunded", "expired"] as const) {
    const ctx = buildCtx({
      entitlement: { userId: "user_1", status },
    });

    const result = await isUserPro(ctx, "user_1");
    assert.equal(result, false);
  }
});
