import assert from "node:assert/strict";
import test from "node:test";

import { generatePptx } from "../tools/generate_pptx";

function createPptxToolCtx() {
  const stored: Blob[] = [];
  const images = new Map<string, Blob>([
    ["image_1", new Blob([new Uint8Array([0, 1, 2, 3])], { type: "image/png" })],
    ["image_2", new Blob([new Uint8Array([4, 5, 6, 7])], { type: "image/jpeg" })],
    ["bg_1", new Blob([new Uint8Array([8, 9, 10, 11])], { type: "image/png" })],
  ]);

  return {
    stored,
    toolCtx: {
      userId: "user_1",
      ctx: {
        storage: {
          get: async (id: string) => images.get(id) ?? null,
          store: async (blob: Blob) => {
            stored.push(blob);
            return "pptx_storage_1";
          },
          getUrl: async (id: string) => `https://storage.example/${id}`,
        },
      },
    } as any,
  };
}

test("generatePptx creates a deck across layouts, images, notes, theme, and site download URLs", async () => {
  const originalSiteUrl = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = "https://files.nanth.ai";
  const { stored, toolCtx } = createPptxToolCtx();

  try {
    const result = await generatePptx.execute(toolCtx, {
      title: "Q1 / Product Review?",
      subtitle: "Board packet",
      showSlideNumbers: true,
      theme: {
        primaryColor: "#112233",
        secondaryColor: "#445566",
        accentColor: "#AA3311",
        titleFont: "Aptos Display",
        bodyFont: "Aptos",
        titleFontSize: 28,
        bodyFontSize: 17,
        backgroundColor: "#F8FAFC",
      },
      slides: [
        {
          title: "Summary",
          body: "- Growth\n* Retention\nPlain line",
          notes: "Read this first.",
          images: [
            { imageStorageId: "image_1", altText: "Chart" },
            { imageStorageId: "missing_image", altText: "Missing" },
          ],
        },
        {
          title: "Split",
          layout: "split",
          body: "Left side text",
          images: [{ imageStorageId: "image_2", altText: "Screenshot" }],
          backgroundImage: { imageStorageId: "bg_1", altText: "Background" },
        },
        {
          title: "Gallery",
          layout: "image",
          body: "Four assets",
          images: [
            { imageStorageId: "image_1" },
            { imageStorageId: "image_2" },
            { imageStorageId: "image_1" },
            { imageStorageId: "image_2" },
          ],
        },
        {
          title: "Section",
          layout: "section",
          body: "Deep dive",
        },
        {
          title: "Table",
          layout: "table",
          table: {
            headers: ["Metric", "Value"],
            rows: [["ARR", "$10m"], ["NDR", "118%"]],
          },
        },
        {
          title: "Chart",
          layout: "chart",
          chart: {
            type: "pie",
            title: "Revenue mix",
            labels: ["Team", "Enterprise"],
            datasets: [{ name: "Revenue", values: [35, 65], color: "#0EA5E9" }],
          },
        },
      ],
    });

    assert.equal(result.success, true);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.type, "application/zip");
    assert.equal((result.data as any).filename, "Q1_Product_Review.pptx");
    assert.equal((result.data as any).slideCount, 7);
    assert.equal((result.data as any).imageCount, 7);
    assert.match((result.data as any).downloadUrl, /^https:\/\/files\.nanth\.ai\/download\?/);
    assert.match((result.data as any).message, /Warnings:/);
    assert.match((result.data as any).message, /missing_image/);
  } finally {
    if (originalSiteUrl === undefined) {
      delete process.env.CONVEX_SITE_URL;
    } else {
      process.env.CONVEX_SITE_URL = originalSiteUrl;
    }
  }
});

test("generatePptx validates required args and falls back from invalid table and chart layouts", async () => {
  delete process.env.CONVEX_SITE_URL;
  const { stored, toolCtx } = createPptxToolCtx();

  const missingTitle = await generatePptx.execute(toolCtx, {
    title: "",
    slides: [{ title: "Slide" }],
  });
  const missingSlides = await generatePptx.execute(toolCtx, {
    title: "Deck",
    slides: [],
  });

  assert.equal(missingTitle.success, false);
  assert.equal(missingTitle.error, "Missing or invalid 'title'");
  assert.equal(missingSlides.success, false);
  assert.equal(missingSlides.error, "'slides' must be a non-empty array");

  const result = await generatePptx.execute(toolCtx, {
    title: "Fallback Layouts",
    slides: [
      {
        title: "Bad table",
        layout: "table",
        body: "Falls back to a text slide when table data is absent.",
        backgroundImage: { imageStorageId: "", data: "", altText: "" },
      },
      {
        title: "Bad chart",
        layout: "chart",
        body: "Falls back to a text slide when chart datasets are absent.",
        chart: { type: "area", labels: ["A"], datasets: undefined },
      },
      {
        title: "Unknown layout",
        layout: "timeline",
        body: "Unknown layouts use the default text renderer.",
      },
      {
        title: "Doughnut defaults",
        layout: "chart",
        chart: {
          type: "doughnut",
          labels: ["One", "Two"],
          datasets: [{ name: "Share", values: [1, 2] }],
        },
      },
    ],
  });

  assert.equal(result.success, true);
  assert.equal(stored.length, 1);
  assert.equal((result.data as any).downloadUrl, "https://storage.example/pptx_storage_1");
  assert.equal((result.data as any).slideCount, 5);
  assert.equal((result.data as any).imageCount, 0);
  assert.doesNotMatch((result.data as any).message, /Warnings:/);
});
