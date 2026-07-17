import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { inspectSlideHtml } from "../presentations/html_contract";

function html(children: string): string {
  return `<section class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden">${children}</section>`;
}

function errorMessage(error: unknown): string {
  return error instanceof ConvexError
    ? String((error.data as { message?: string } | undefined)?.message ?? error.message)
    : String(error);
}

test("slide contract assigns deterministic IDs to SVG primitives", () => {
  const inspected = inspectSlideHtml(html(
    '<svg data-element-id="chart" viewBox="0 0 100 100">' +
    '<rect x="10" y="20" width="30" height="60" fill="#3355ff" />' +
    '<path d="M0 0 L10 10" stroke="#111" /></svg>',
  ));
  assert.match(inspected.html, /<rect[^>]*data-element-id="svg-rect-1"/);
  assert.match(inspected.html, /<path[^>]*data-element-id="svg-path-1"/);
  assert.deepEqual([...inspected.elementIds], ["chart", "svg-rect-1", "svg-path-1"]);
  assert.equal(inspectSlideHtml(inspected.html).html, inspected.html);
});

test("slide contract aggregates missing and duplicate IDs with exact tags", () => {
  assert.throws(() => inspectSlideHtml(html(
    '<div>Missing</div>' +
    '<p data-element-id="copy">First</p>' +
    '<span data-element-id="copy">Duplicate</span>',
  )), (error: unknown) => {
    const message = errorMessage(error);
    assert.match(message, /missing data-element-id on <div>/);
    assert.match(message, /duplicate data-element-id 'copy' on <span>/);
    return true;
  });
});
