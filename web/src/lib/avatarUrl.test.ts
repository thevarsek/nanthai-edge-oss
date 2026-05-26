import { describe, expect, it } from "vitest";
import { safeAvatarImageUrl } from "./avatarUrl";

describe("safeAvatarImageUrl", () => {
  it("allows app-local, blob, and Convex-hosted avatar images", () => {
    expect(safeAvatarImageUrl("/avatars/local.png")).toBe("http://localhost:3000/avatars/local.png");
    expect(safeAvatarImageUrl("blob:http://localhost:3000/avatar")).toBe("blob:http://localhost:3000/avatar");
    expect(safeAvatarImageUrl("https://files.convex.site/download?filename=avatar.png")).toBe(
      "https://files.convex.site/download?filename=avatar.png",
    );
  });

  it("rejects untrusted external and scriptable avatar URLs", () => {
    expect(safeAvatarImageUrl("https://example.test/tracker.png")).toBeNull();
    expect(safeAvatarImageUrl("data:image/svg+xml,<svg></svg>")).toBeNull();
    expect(safeAvatarImageUrl("javascript:alert(1)")).toBeNull();
  });
});
