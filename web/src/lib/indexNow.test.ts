import { describe, expect, it, vi } from "vitest";
import {
  extractCanonicalUrls,
  INDEXNOW_ENDPOINT,
  INDEXNOW_KEY,
  INDEXNOW_KEY_LOCATION,
  INDEXNOW_SITEMAP,
  shouldSubmitIndexNow,
  submitIndexNow,
} from "../../netlify/functions/_shared/indexNow";

describe("IndexNow deployment integration", () => {
  it("runs only after a published production deployment", () => {
    expect(shouldSubmitIndexNow({ context: "production", publishedAt: "2026-07-13T12:00:00Z" })).toBe(true);
    expect(shouldSubmitIndexNow({ context: "deploy-preview", publishedAt: "2026-07-13T12:00:00Z" })).toBe(false);
    expect(shouldSubmitIndexNow({ context: "production", publishedAt: null })).toBe(false);
  });

  it("extracts unique canonical NanthAI URLs and rejects other hosts", () => {
    expect(extractCanonicalUrls(`
      <urlset>
        <url><loc>https://nanthai.tech/</loc></url>
        <url><loc>https://nanthai.tech/features/search</loc></url>
        <url><loc>https://nanthai.tech/features/search</loc></url>
        <url><loc>https://example.com/copied</loc></url>
      </urlset>
    `)).toEqual([
      "https://nanthai.tech/",
      "https://nanthai.tech/features/search",
    ]);
  });

  it("submits the production sitemap URLs with the verified key", async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(new Response(
        "<urlset><url><loc>https://nanthai.tech/</loc></url></urlset>",
        { status: 200 },
      ))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    await expect(submitIndexNow(fetchImplementation)).resolves.toBe(1);
    expect(fetchImplementation).toHaveBeenNthCalledWith(1, INDEXNOW_SITEMAP, {
      headers: { Accept: "application/xml" },
    });
    const [, request] = fetchImplementation.mock.calls[1];
    expect(fetchImplementation.mock.calls[1][0]).toBe(INDEXNOW_ENDPOINT);
    expect(JSON.parse(request.body)).toEqual({
      host: "nanthai.tech",
      key: INDEXNOW_KEY,
      keyLocation: INDEXNOW_KEY_LOCATION,
      urlList: ["https://nanthai.tech/"],
    });
  });
});
