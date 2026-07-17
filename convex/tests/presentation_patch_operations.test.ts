import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { applyPresentationPatch } from "../presentations/patch_operations";

const current = '<section class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden"><h1 data-element-id="headline" style="position:absolute;left:80px;top:80px">Before</h1><p data-element-id="body" style="position:absolute;left:80px;top:220px">Keep</p></section>';

function errorCode(error: unknown): string | undefined {
  return error instanceof ConvexError
    ? (error.data as { code?: string } | undefined)?.code
    : undefined;
}

test("presentation patches apply deterministic text and geometry operations", () => {
  const result = applyPresentationPatch({
    currentHtml: current,
    allowedAssetStorageIds: [],
    operations: [
      { op: "replace_text", elementId: "headline", text: "After & safer" },
      {
        op: "set_style",
        elementId: "body",
        style: "position:absolute;left:100px;top:240px;color:#222",
      },
    ],
  });
  assert.match(result, /After &amp; safer/);
  assert.match(result, /left:100px/);
  assert.match(result, />Keep<\/p>/);
});

test("element-targeted patches reject sibling edits and stable-ID removal", () => {
  assert.throws(
    () => applyPresentationPatch({
      currentHtml: current,
      allowedAssetStorageIds: [],
      targetElementId: "headline",
      operations: [{ op: "replace_text", elementId: "body", text: "Changed" }],
    }),
    (error: unknown) => errorCode(error) === "MODEL_RESPONSE_INVALID",
  );
  assert.throws(
    () => applyPresentationPatch({
      currentHtml: current,
      allowedAssetStorageIds: [],
      operations: [{
        op: "replace_element",
        elementId: "headline",
        html: '<h1 data-element-id="renamed" style="position:absolute">After</h1>',
      }],
    }),
    (error: unknown) => errorCode(error) === "MODEL_RESPONSE_INVALID",
  );
});

test("presentation patches accept only project-owned asset placeholders", () => {
  const result = applyPresentationPatch({
    currentHtml: current,
    allowedAssetStorageIds: ["storage_image_1"],
    operations: [{
      op: "insert_after",
      elementId: "headline",
      html: '<img data-element-id="hero" src="asset:storage_image_1" alt="Reference" style="position:absolute;left:700px;top:80px;width:400px;height:400px">',
    }],
  });
  assert.match(result, /asset:storage_image_1/);
  assert.throws(
    () => applyPresentationPatch({
      currentHtml: current,
      allowedAssetStorageIds: ["storage_image_1"],
      operations: [{
        op: "insert_after",
        elementId: "headline",
        html: '<img data-element-id="bad" src="asset:someone_else" alt="Bad">',
      }],
    }),
    (error: unknown) => errorCode(error) === "MODEL_RESPONSE_INVALID",
  );
});
