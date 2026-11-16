import { describe, expect, it } from "vitest";
import { isConvexImageUrl, trustedConvexImageHosts } from "./markdownImageHost";

const hosts = trustedConvexImageHosts(["https://own-deploy-1.convex.cloud"]);
const query = "/download?storageId=abc&filename=chart.png";

describe("trustedConvexImageHosts", () => {
  it("derives the cloud and site twins from either form", () => {
    const expected = new Set(["own-deploy-1.convex.cloud", "own-deploy-1.convex.site"]);
    expect(trustedConvexImageHosts(["https://own-deploy-1.convex.cloud"])).toEqual(expected);
    expect(trustedConvexImageHosts(["https://own-deploy-1.convex.site"])).toEqual(expected);
    expect(trustedConvexImageHosts([undefined, "", "not a url"]).size).toBe(0);
  });
});

describe("isConvexImageUrl", () => {
  it("accepts the own deployment on both hosts", () => {
    expect(isConvexImageUrl(`https://own-deploy-1.convex.site${query}`, hosts)).toBe(true);
    expect(isConvexImageUrl(`https://own-deploy-1.convex.cloud${query}`, hosts)).toBe(true);
  });

  it("rejects other Convex deployments", () => {
    expect(isConvexImageUrl(`https://attacker-123.convex.site${query}`, hosts)).toBe(false);
    expect(isConvexImageUrl(`https://attacker-123.convex.cloud${query}`, hosts)).toBe(false);
  });

  it.each([
    "https://own-deploy-1.convex.site.evil.com",
    "https://evil.com/own-deploy-1.convex.site",
    "https://x.own-deploy-1.convex.site",
    "https://own-deploy-1.convex.sitee",
    "https://own-deploy-1-convex.site",
    "https://own-deploy-1.convex.site@evil.com",
    "https://own-deploy-1.convex.site:8443",
  ])("rejects lookalike host %s", (host) => {
    expect(isConvexImageUrl(`${host}${query}`, hosts)).toBe(false);
  });

  it("rejects http, credentials, other paths and non-image files", () => {
    expect(isConvexImageUrl(`http://own-deploy-1.convex.site${query}`, hosts)).toBe(false);
    expect(isConvexImageUrl(`https://user:pw@own-deploy-1.convex.site${query}`, hosts)).toBe(false);
    expect(isConvexImageUrl("https://own-deploy-1.convex.site/other?filename=a.png", hosts)).toBe(false);
    expect(isConvexImageUrl("https://own-deploy-1.convex.site/download?filename=a.pdf", hosts)).toBe(false);
    expect(isConvexImageUrl("https://own-deploy-1.convex.site/download", hosts)).toBe(false);
    expect(isConvexImageUrl("not a url", hosts)).toBe(false);
  });

  it("trusts nothing when no deployment is configured", () => {
    expect(isConvexImageUrl(`https://own-deploy-1.convex.site${query}`, new Set())).toBe(false);
  });
});
