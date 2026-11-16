import { describe, expect, it, vi } from "vitest";
import { AUTHENTICATED_CACHE_NAMES, clearAuthenticatedCaches } from "./clearAuthenticatedCaches";

describe("clearAuthenticatedCaches", () => {
  it("deletes every authenticated cache", async () => {
    const del = vi.fn().mockResolvedValue(true);
    await clearAuthenticatedCaches({ delete: del });
    expect(del.mock.calls.map(([name]) => name)).toEqual([...AUTHENTICATED_CACHE_NAMES]);
    expect(AUTHENTICATED_CACHE_NAMES).toContain("convex-api");
  });

  it("does not throw when a deletion fails or Cache Storage is missing", async () => {
    await expect(clearAuthenticatedCaches({ delete: vi.fn().mockRejectedValue(new Error("blocked")) })).resolves.toBeUndefined();
    await expect(clearAuthenticatedCaches(undefined)).resolves.toBeUndefined();
  });
});
