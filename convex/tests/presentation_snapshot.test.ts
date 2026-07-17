import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import {
  createPptxSnapshot,
  slideTextFromHtml,
} from "../tools/presentation_snapshot";

test("presentation snapshot extracts readable text without labeling HTML as PPTX", () => {
  const text = slideTextFromHtml(
    '<section class="slide-root"><h1 data-element-id="title">Growth &amp; focus</h1><p data-element-id="body">Revenue rose 23%</p><svg><text>noise</text></svg></section>',
  );
  assert.equal(text, "Growth & focus\nRevenue rose 23%");
  assert.doesNotMatch(text, /<section|<svg/);
});

test("presentation snapshot keeps the canonical slide count", async () => {
  let stored: Blob | undefined;
  const result = await createPptxSnapshot({
    userId: "user_1",
    ctx: {
      storage: {
        store: async (blob: Blob) => {
          stored = blob;
          return "storage_1";
        },
        getUrl: async () => "https://files.example/deck.pptx",
      },
    },
  } as any, {
    _id: "project_1",
    _creationTime: 1,
    userId: "user_1",
    title: "One slide",
    status: "ready",
    sourceKind: "scratch",
    prompt: "Brief",
    direction: "minimal",
    imageMode: "none",
    aspectRatio: "16:9",
    revision: 2,
    createdAt: 1,
    updatedAt: 1,
  } as any, [{
    _id: "slide_row_1",
    _creationTime: 1,
    userId: "user_1",
    projectId: "project_1",
    slideId: "slide_01",
    position: 0,
    title: "Opening",
    html: '<section class="slide-root"><h1 data-element-id="title">Opening</h1></section>',
    revision: 0,
    createdAt: 1,
    updatedAt: 1,
  }] as any);

  assert.equal(result.success, true);
  assert.equal((result.data as { slideCount: number }).slideCount, 1);
  assert.ok(stored);
  const zip = await JSZip.loadAsync(await stored!.arrayBuffer());
  const slideFiles = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.equal(slideFiles.length, 1);
});
