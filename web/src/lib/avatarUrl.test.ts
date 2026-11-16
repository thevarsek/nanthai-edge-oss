import { describe, expect, it } from "vitest";
import { safeAvatarImageUrl } from "./avatarUrl";

const OWN_HOSTS = new Set(["files.convex.cloud", "files.convex.site"]);

describe("safeAvatarImageUrl", () => {
  it("allows app-local, blob, and own-deployment avatar images", () => {
    expect(safeAvatarImageUrl("/avatars/local.png", OWN_HOSTS)).toBe("http://localhost:3000/avatars/local.png");
    expect(safeAvatarImageUrl("blob:http://localhost:3000/avatar", OWN_HOSTS)).toBe("blob:http://localhost:3000/avatar");
    expect(safeAvatarImageUrl("https://files.convex.site/download?filename=avatar.png", OWN_HOSTS)).toBe(
      "https://files.convex.site/download?filename=avatar.png",
    );
  });

  it("rejects other Convex deployments and plain http on the deployment host", () => {
    expect(safeAvatarImageUrl("https://attacker.convex.site/download?filename=a.png", OWN_HOSTS)).toBeNull();
    expect(safeAvatarImageUrl("https://attacker.convex.cloud/a.png", OWN_HOSTS)).toBeNull();
    expect(safeAvatarImageUrl("http://files.convex.site/a.png", OWN_HOSTS)).toBeNull();
  });

  it("uses the configured deployment by default", () => {
    expect(safeAvatarImageUrl("https://someone-else.convex.site/a.png")).toBeNull();
  });

  it("rejects untrusted external and scriptable avatar URLs", () => {
    expect(safeAvatarImageUrl("https://example.test/tracker.png", OWN_HOSTS)).toBeNull();
    expect(safeAvatarImageUrl("data:image/svg+xml,<svg></svg>", OWN_HOSTS)).toBeNull();
    expect(safeAvatarImageUrl("javascript:alert(1)", OWN_HOSTS)).toBeNull();
  });
});
