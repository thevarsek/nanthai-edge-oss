import assert from "node:assert/strict";
import test from "node:test";
import {
  GeneratedSlideLayoutError,
  validateGeneratedSlideLayout,
  validateGeneratedSlideLayoutIssues,
} from "../presentations/generated_layout_validation";
import { applyDeterministicLayoutAutofix } from "../presentations/layout_autofix";

function slide(children: string): string {
  return `<section class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden">${children}</section>`;
}

function isInvalid(error: unknown): boolean {
  return error instanceof GeneratedSlideLayoutError;
}

test("allocated text boxes may overlap when their estimated rendered words do not", () => {
  assert.doesNotThrow(() => validateGeneratedSlideLayout(slide(
    '<h1 data-element-id="s05-title" style="position:absolute;left:80px;top:84px;width:720px;height:92px;font-size:40px;line-height:44px">Identity is infrastructure</h1>' +
    '<p data-element-id="s05-sub" style="position:absolute;left:80px;top:154px;width:720px;height:64px;font-size:20px;line-height:26px">Trust follows the agent across systems.</p>',
  )));
});

test("missing allocated height or anchors are not hard layout failures", () => {
  assert.doesNotThrow(() => validateGeneratedSlideLayout(slide(
    '<h1 data-element-id="title" style="position:absolute;left:72px;top:72px;width:800px;font-size:42px">Title</h1>' +
    '<p data-element-id="flow" style="position:absolute;width:600px;font-size:20px">Unknown browser placement</p>',
  )));
});

test("text may overlap decorative HTML and SVG geometry", () => {
  assert.doesNotThrow(() => validateGeneratedSlideLayout(slide(
    '<div data-element-id="wash" style="position:absolute;left:40px;top:40px;width:900px;height:240px;background:#eee"></div>' +
    '<svg data-element-id="art" style="position:absolute;left:60px;top:60px;width:700px;height:300px" viewBox="0 0 700 300"><circle data-element-id="orb" cx="160" cy="120" r="100" fill="#ddd" /></svg>' +
    '<h1 data-element-id="title" style="position:absolute;left:80px;top:100px;width:600px;height:100px;font-size:48px;line-height:56px">Layered editorial title</h1>',
  )));
});

test("severe estimated word overlap remains blocking", () => {
  assert.throws(() => validateGeneratedSlideLayout(slide(
    '<h1 data-element-id="title" style="position:absolute;left:80px;top:100px;width:700px;height:120px;font-size:40px;line-height:48px">The same words occupy this line</h1>' +
    '<p data-element-id="subtitle" style="position:absolute;left:80px;top:120px;width:700px;height:80px;font-size:40px;line-height:48px">More words occupy the same line</p>',
  )), (error: unknown) => {
    assert.ok(isInvalid(error));
    assert.equal((error as GeneratedSlideLayoutError).issue.code, "overlap");
    return true;
  });
});

test("only estimated rendered text leaving the page is rejected", () => {
  assert.doesNotThrow(() => validateGeneratedSlideLayout(slide(
    '<p data-element-id="footer" style="position:absolute;left:72px;top:650px;width:800px;height:140px;font-size:24px;line-height:30px">Visible words remain inside.</p>',
  )));
  assert.throws(() => validateGeneratedSlideLayout(slide(
    '<p data-element-id="footer" style="position:absolute;left:72px;top:700px;width:800px;height:20px;font-size:24px;line-height:30px">Words leave the page.</p>',
  )), isInvalid);
});

test("br contributes actual lines and nested coordinates resolve to the page", () => {
  assert.throws(() => validateGeneratedSlideLayout(slide(
    '<div data-element-id="region" style="position:absolute;left:40px;top:600px;width:900px;height:80px">' +
    '<h1 data-element-id="title" style="position:absolute;left:40px;top:50px;width:720px;height:60px;font-size:32px;line-height:36px">First line<br>Second line</h1></div>',
  )), isInvalid);
  assert.doesNotThrow(() => validateGeneratedSlideLayout(slide(
    '<div data-element-id="region" style="position:absolute;left:40px;top:100px;width:900px;height:80px">' +
    '<h1 data-element-id="title" style="position:absolute;left:40px;top:50px;width:720px;height:60px;font-size:32px;line-height:36px">First line<br>Second line</h1></div>',
  )));
});

test("all severe layout issues are returned in one validation pass", () => {
  const issues = validateGeneratedSlideLayoutIssues(slide(
    '<p data-element-id="one" style="position:absolute;left:80px;top:700px;width:500px;height:30px;font-size:24px;line-height:30px">First overflow</p>' +
    '<p data-element-id="two" style="position:absolute;left:600px;top:705px;width:500px;height:30px;font-size:24px;line-height:30px">Second overflow</p>',
  ));
  assert.equal(issues.length, 2);
  assert.deepEqual(issues.map((issue) => "elementId" in issue ? issue.elementId : undefined), ["one", "two"]);
  assert.throws(() => validateGeneratedSlideLayout(slide(
    '<p data-element-id="one" style="position:absolute;left:80px;top:700px;width:500px;height:30px;font-size:24px;line-height:30px">First overflow</p>' +
    '<p data-element-id="two" style="position:absolute;left:600px;top:705px;width:500px;height:30px;font-size:24px;line-height:30px">Second overflow</p>',
  )), (error: unknown) => {
    assert.ok(error instanceof GeneratedSlideLayoutError);
    assert.equal(error.issues.length, 2);
    return true;
  });
});

test("deterministic layout autofix changes only the overflowing element style", () => {
  const html = slide(
    '<h1 data-element-id="title" style="position:absolute;left:80px;top:680px;width:720px;height:40px;font-size:32px;line-height:36px;color:red">First line<br>Second line</h1>' +
    '<p data-element-id="subtitle" style="position:absolute;left:82px;top:260px;width:620px;height:48px;font-size:20px">Untouched copy</p>',
  );
  const issue = validateGeneratedSlideLayoutIssues(html)[0];
  assert.ok(issue);
  const repaired = applyDeterministicLayoutAutofix(html, issue);
  assert.ok(repaired);
  assert.match(repaired, /data-element-id="title"[^>]*top:/);
  assert.match(repaired, /color:red/);
  assert.match(repaired, /data-element-id="subtitle" style="position:absolute;left:82px;top:260px/);
  assert.doesNotThrow(() => validateGeneratedSlideLayout(repaired));
});
