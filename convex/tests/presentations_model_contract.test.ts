import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { inspectSlideHtml } from "../presentations/html_contract";
import {
  PresentationDeckSlideLayoutError,
  parseModelJson,
  parsePresentationDeck,
  parsePresentationEdit,
  parsePresentationPlan,
} from "../presentations/model_parsing";
import { applyPresentationLayoutRepair } from "../presentations/generation_layout_repair";
import { defaultPresentationTypographyRoles } from "../presentations/model_typography_schema";

const ASSET_ID = "storage_asset_1";

function html(children: string, extraRootStyle = ""): string {
  return `<section class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden;${extraRootStyle}">${children}</section>`;
}

function heading(id = "headline", text = "A clear idea"): string {
  return `<h1 data-element-id="${id}" style="position:absolute;left:80px;top:80px;width:720px;height:100px;font-size:64px;color:#111">${text}</h1>`;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof ConvexError
    ? (error.data as { code?: string } | undefined)?.code
    : undefined;
}

test("presentation planning parser accepts fenced JSON and enforces varied stable plans", () => {
  const parsed = parsePresentationPlan(`Here is the result:\n\`\`\`json
  {"schemaVersion":1,"title":"Future of work","slides":[
    {"id":"slide_01","title":"Opening","purpose":"Set the tension","layout":"full-bleed opener","imageIntent":"Editorial workplace image"},
    {"id":"slide_02","title":"Shift","purpose":"Explain change","layout":"split comparison","imageIntent":""},
    {"id":"slide_03","title":"Action","purpose":"Close with action","layout":"annotated timeline","imageIntent":""}
  ]}\n\`\`\``);

  assert.equal(parsed.title, "Future of work");
  assert.deepEqual(parsed.slides.map((slide) => slide.id), ["slide_01", "slide_02", "slide_03"]);
  assert.deepEqual(parseModelJson("prefix {\"schemaVersion\":1} suffix"), { schemaVersion: 1 });
  assert.throws(
    () => parsePresentationPlan('{"schemaVersion":1,"title":"Repeated","slides":[{"id":"a","title":"A","purpose":"A","layout":"cards","imageIntent":""},{"id":"b","title":"B","purpose":"B","layout":"cards","imageIntent":""}]}'),
    (error: unknown) => errorCode(error) === "MODEL_RESPONSE_INVALID",
  );
  assert.throws(
    () => parseModelJson("```json\n{bad json}\n```"),
    (error: unknown) => errorCode(error) === "MODEL_RESPONSE_INVALID",
  );
});

test("presentation planning parser normalizes useful object and array layouts", () => {
  const parsed = parsePresentationPlan(JSON.stringify({
    schemaVersion: 1,
    title: "Flexible layouts",
    slides: [
      {
        id: "slide_01",
        title: "Opening",
        purpose: "Open",
        layout: { composition: "hero", alignment: "asymmetric" },
        imageIntent: "",
      },
      {
        id: "slide_02",
        title: "Evidence",
        purpose: "Explain",
        layout: ["two columns", "annotated chart"],
        imageIntent: "",
      },
      {
        id: "slide_03",
        title: "Action",
        purpose: "Close",
        layout: { type: "timeline", details: ["three stages", "callout"] },
        imageIntent: "",
      },
    ],
  }));
  assert.equal(parsed.slides[0]?.layout, "composition: hero; alignment: asymmetric");
  assert.equal(parsed.slides[1]?.layout, "two columns; annotated chart");
  assert.match(parsed.slides[2]?.layout ?? "", /timeline/);
});

test("presentation planning parser strips unknown model metadata", () => {
  const plan = {
    schemaVersion: 1,
    title: "Planning aliases",
    modelCommentary: "Not part of the persisted contract.",
    creativeDirection: {
      palette: "Black and white",
      typography: "Editorial",
      typographyRoles: defaultPresentationTypographyRoles,
      spacing: "Generous",
      shapeLanguage: "Sharp",
      footerTreatment: "Quiet",
      motifs: ["Rules"],
      deckRhythm: "Alternate scale",
      unsupportedToken: "drop me",
    },
    slides: [
      {
        id: "slide_01",
        title: "Opening",
        purpose: "Open",
        layout: "hero",
        imageIntent: "",
        speakerNotes: "Introduce the core tension.",
      },
      {
        id: "slide_02",
        title: "Evidence",
        purpose: "Explain",
        layout: "annotated chart",
        imageIntent: "",
      },
      {
        id: "slide_03",
        title: "Action",
        purpose: "Close",
        layout: "timeline",
        imageIntent: "",
      },
    ],
  };

  const parsed = parsePresentationPlan(JSON.stringify(plan));
  assert.equal(parsed.slides[0]?.id, "slide_01");
  assert.equal("speakerNotes" in (parsed.slides[0] ?? {}), false);
  assert.equal("modelCommentary" in parsed, false);
  assert.equal("unsupportedToken" in parsed.creativeDirection, false);
});

test("presentation planning parser supports the twenty-slide product limit", () => {
  const slides = Array.from({ length: 20 }, (_, index) => ({
    id: `slide_${String(index + 1).padStart(2, "0")}`,
    title: `Slide ${index + 1}`,
    purpose: `Purpose ${index + 1}`,
    layout: `layout-${index + 1}`,
    imageIntent: "",
  }));

  assert.equal(parsePresentationPlan(JSON.stringify({
    schemaVersion: 1,
    title: "Twenty slides",
    slides,
  })).slides.length, 20);
  assert.throws(
    () => parsePresentationPlan(JSON.stringify({
      schemaVersion: 1,
      title: "Twenty-one slides",
      slides: [...slides, {
        id: "slide_21",
        title: "Slide 21",
        purpose: "Purpose 21",
        layout: "layout-21",
        imageIntent: "",
      }],
    })),
    (error: unknown) => errorCode(error) === "MODEL_RESPONSE_INVALID",
  );
});

test("safe slide contract accepts geometry and rejects active or external content", () => {
  const safe = html(
    heading("headline", "A clear<br>idea") +
      '<svg data-element-id="chart" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect data-element-id="bar" x="10" y="20" width="30" height="60" fill="#3355ff" /></svg>',
    "background:linear-gradient(135deg,#fff,#eef);",
  );
  const inspected = inspectSlideHtml(safe);
  assert.deepEqual([...inspected.elementIds], ["headline", "chart", "bar"]);
  assert.doesNotThrow(() => inspectSlideHtml(html(heading("headline", "A clear<br/>idea"))));

  for (const unsafe of [
    html('<script data-element-id="bad">alert(1)</script>'),
    html('<div data-element-id="bad" onclick="alert(1)">Click</div>'),
    html('<div data-element-id="bad" style="background:url(https://example.com/x)">X</div>'),
    html('<div data-element-id="bad" style="background:image-set(https://example.com/x)">X</div>'),
    html('<div data-element-id="bad" style="background:u/**/rl(https://example.com/x)">X</div>'),
    html('<div data-element-id="bad" style="background-image:&#117;rl(&#104;ttps://example.com/x)">X</div>'),
    html('<svg data-element-id="bad" viewBox="0 0 10 10"><path data-element-id="path" fill="&#117;rl(&#104;ttps://example.com/x)" /></svg>'),
    html('<img data-element-id="bad" src="https://example.com/x.jpg" alt="x">'),
    html('<p style="color:#111">Missing stable ID</p>'),
    `${html(heading())}<div data-element-id="outside" style="position:absolute">Outside</div>`,
  ]) {
    assert.throws(
      () => inspectSlideHtml(unsafe, [ASSET_ID]),
      (error: unknown) => errorCode(error) === "MODEL_RESPONSE_INVALID",
    );
  }
});

test("deck parser preserves plan order and accepts only owned reference assets", () => {
  const plan = [
    { id: "slide_01", title: "Open", purpose: "Open", layout: "hero", imageIntent: "Photo" },
    { id: "slide_02", title: "Close", purpose: "Close", layout: "statement", imageIntent: "" },
  ];
  const withImage = html(
    heading() + `<img data-element-id="hero_image" src="asset:${ASSET_ID}" alt="Team collaborating" style="position:absolute;left:700px;top:80px;width:500px;height:560px;object-fit:cover">`,
  );
  const parsed = parsePresentationDeck(JSON.stringify({
    schemaVersion: 1,
    slides: [
      { id: "slide_01", title: "Open", html: withImage },
      { id: "slide_02", title: "Close", html: html(heading("close", "Act now")) },
    ],
  }), plan, "references", [ASSET_ID]);
  assert.equal(parsed.slides.length, 2);

  assert.throws(
    () => parsePresentationDeck(JSON.stringify({
      schemaVersion: 1,
      slides: plan.map((slide) => ({ id: slide.id, title: slide.title, html: html(heading(slide.id)) })),
    }), plan, "mixed", [ASSET_ID]),
    (error: unknown) => errorCode(error) === "MODEL_RESPONSE_INVALID",
  );
  assert.throws(
    () => parsePresentationDeck(JSON.stringify({
      schemaVersion: 1,
      slides: [{ id: "slide_02", title: "Wrong order", html: html(heading()) }],
    }), plan, "none"),
    (error: unknown) => errorCode(error) === "MODEL_RESPONSE_INVALID",
  );
});

test("deck layout failures identify one slide and accept a style-only local repair", () => {
  const plan = [
    { id: "slide_01", title: "Signal", purpose: "Explain", layout: "editorial", imageIntent: "" },
  ];
  const candidateContent = JSON.stringify({
    schemaVersion: 1,
    slides: [{
      id: "slide_01",
      title: "Signal",
      html: html(
        '<h1 data-element-id="headline" style="position:absolute;left:80px;top:80px;width:720px;height:120px;font-size:52px;line-height:1.1;color:#111">A clear signal</h1>' +
        '<p data-element-id="meta" style="position:absolute;left:80px;top:100px;width:720px;height:60px;font-size:40px;line-height:48px;color:#555">Source · Today</p>',
      ),
    }],
  });
  assert.throws(
    () => parsePresentationDeck(candidateContent, plan, "none"),
    (error: unknown) =>
      error instanceof PresentationDeckSlideLayoutError && error.slideId === "slide_01",
  );
  assert.equal(
    parsePresentationDeck(candidateContent, plan, "none", [], true, "release").slides[0]?.id,
    "slide_01",
  );

  const repaired = applyPresentationLayoutRepair({
    candidateContent,
    repairContent: JSON.stringify({
      schemaVersion: 1,
      slideId: "slide_01",
      operations: [{
        op: "set_style",
        elementId: "meta",
        style: "position:absolute;left:80px;top:220px;width:720px;height:40px;font-size:20px;line-height:24px;color:#555",
      }],
    }),
    targetSlideId: "slide_01",
    plan,
    imageMode: "none",
    allowedAssetStorageIds: [],
  });
  assert.equal(repaired.deck.slides[0]?.id, "slide_01");
  assert.match(repaired.deck.slides[0]?.html ?? "", /top:220px/);

  assert.throws(
    () => applyPresentationLayoutRepair({
      candidateContent,
      repairContent: JSON.stringify({
        schemaVersion: 1,
        slideId: "slide_01",
        operations: [{ op: "replace_text", elementId: "meta", text: "Changed" }],
      }),
      targetSlideId: "slide_01",
      plan,
      imageMode: "none",
      allowedAssetStorageIds: [],
    }),
    (error: unknown) => errorCode(error) === "MODEL_RESPONSE_INVALID",
  );
});

test("AI edit parser keeps slide and element IDs stable", () => {
  const current = html(heading("headline", "Before") + '<p data-element-id="body" style="position:absolute;left:80px;top:200px">Body</p>');
  const parsed = parsePresentationEdit(JSON.stringify({
    schemaVersion: 1,
    slideId: "slide_01",
    title: "After",
    operations: [
      { op: "replace_text", elementId: "headline", text: "After" },
      { op: "set_style", elementId: "body", style: "position:absolute;left:80px;top:220px" },
    ],
  }), current, "slide_01", [], "Before");
  assert.match(parsed.html, /After/);

  assert.throws(
    () => parsePresentationEdit(JSON.stringify({
      schemaVersion: 1,
      slideId: "slide_01",
      operations: [{
        op: "replace_element",
        elementId: "body",
        html: '<p data-element-id="replacement" style="position:absolute">After</p>',
      }],
    }), current, "slide_01", [], "Before"),
    (error: unknown) => errorCode(error) === "MODEL_RESPONSE_INVALID",
  );
});

test("element-scoped AI edits reject changes outside the selected subtree", () => {
  const current = html(
    heading("headline", "Before") +
      '<p data-element-id="body" style="position:absolute;left:80px;top:220px">Keep me</p>',
  );
  const parsed = parsePresentationEdit(JSON.stringify({
    schemaVersion: 1,
    slideId: "slide_01",
    operations: [{ op: "replace_text", elementId: "headline", text: "After" }],
  }), current, "slide_01", [], "Before", undefined, "headline");
  assert.match(parsed.html, /After/);

  assert.throws(
    () => parsePresentationEdit(JSON.stringify({
      schemaVersion: 1,
      slideId: "slide_01",
      operations: [
        { op: "replace_text", elementId: "headline", text: "After" },
        { op: "replace_text", elementId: "body", text: "Changed too" },
      ],
    }), current, "slide_01", [], "Before", undefined, "headline"),
    (error: unknown) => errorCode(error) === "MODEL_RESPONSE_INVALID",
  );
});
