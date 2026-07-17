import assert from "node:assert/strict";
import test from "node:test";
import { applyPresentationLayoutRepair } from "../presentations/generation_layout_repair";
import { layoutRepairElementIds } from "../presentations/generation_layout_repair_targets";

const plan = [{
  id: "slide_01", title: "Signal", purpose: "Explain", layout: "editorial", imageIntent: "",
}];
const candidateContent = JSON.stringify({
  schemaVersion: 1,
  slides: [{
    id: "slide_01",
    title: "Signal",
    html: '<section class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden">' +
      '<h1 data-element-id="title" style="position:absolute;left:80px;top:100px;width:700px;height:120px;font-size:40px;line-height:48px">The same words occupy this line</h1>' +
      '<p data-element-id="subtitle" style="position:absolute;left:80px;top:120px;width:700px;height:80px;font-size:40px;line-height:48px">More words occupy the same line</p></section>',
  }],
});

function repair(elementId: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    slideId: "slide_01",
    operations: [{
      op: "set_style",
      elementId,
      style: "position:absolute;left:80px;top:220px;width:700px;height:80px;font-size:40px;line-height:48px",
    }],
  });
}

test("layout repair targets collect every reported element", () => {
  assert.deepEqual(layoutRepairElementIds(JSON.stringify([
    { code: "overlap", elementIds: ["title", "subtitle"] },
    { code: "wrapped_overflow", elementId: "footer" },
  ])), ["title", "subtitle", "footer"]);
});

test("layout patches cannot edit elements absent from the reported issues", () => {
  assert.throws(() => applyPresentationLayoutRepair({
    candidateContent,
    repairContent: repair("subtitle"),
    targetSlideId: "slide_01",
    plan,
    imageMode: "none",
    allowedAssetStorageIds: [],
    allowedElementIds: ["title"],
  }), /reported elements/);
  assert.equal(applyPresentationLayoutRepair({
    candidateContent,
    repairContent: repair("subtitle"),
    targetSlideId: "slide_01",
    plan,
    imageMode: "none",
    allowedAssetStorageIds: [],
    allowedElementIds: ["title", "subtitle"],
  }).deck.slides[0]?.id, "slide_01");
});
