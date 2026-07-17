import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { inspectSlideHtml } from "../presentations/html_contract";
import { parsePresentationPlan } from "../presentations/model_parsing";
import { buildGenerationMessages, buildPlanningMessages } from "../presentations/prompts";
import { harmonizePresentationTypography } from "../presentations/typography_harmonization";
import type { PresentationTypographyRoles } from "../presentations/types";

const roles: PresentationTypographyRoles = {
  displayTitle: { fontFamily: "Georgia, serif", fontWeight: 700 },
  slideTitle: { fontFamily: "Aptos Display, sans-serif", fontWeight: 700 },
  body: { fontFamily: "Aptos, sans-serif", fontWeight: 400 },
  label: { fontFamily: "Aptos, sans-serif", fontWeight: 600 },
  kicker: { fontFamily: "Aptos, sans-serif", fontWeight: 700 },
  sequenceNumber: { fontFamily: "Georgia, serif", fontWeight: 800 },
  footer: { fontFamily: "Aptos, sans-serif", fontWeight: 400 },
};

function errorCode(error: unknown): string | undefined {
  return error instanceof ConvexError
    ? (error.data as { code?: string } | undefined)?.code
    : undefined;
}

test("typography harmonization changes only role family and weight", () => {
  const source = '<section class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden;background:#102A43">' +
    '<h1 data-element-id="s05-title" data-element-role="slide-title" style="position:absolute;left:64px;top:48px;width:720px;height:92px;font-family:Courier New;font-size:56px;font-weight:500;color:#E8843A">Signal</h1>' +
    '<div data-element-id="s05-number" style="position:absolute;left:20px;top:32px;width:120px;height:180px;font-family:Arial;font-size:130px;font-weight:400;color:#1479FF">05</div>' +
    '<p data-element-id="s05-copy" style="position:absolute;left:64px;top:180px;width:560px;height:120px;font-family:Times New Roman;font-size:24px;font-weight:300;color:#F7F5F0">Body copy</p>' +
    '</section>';

  const result = harmonizePresentationTypography(inspectSlideHtml(source).html, roles);
  assert.match(result, /s05-title[^>]*font-family:Aptos Display, sans-serif/);
  assert.match(result, /s05-title[^>]*font-weight:700/);
  assert.match(result, /s05-title[^>]*font-size:56px/);
  assert.match(result, /s05-title[^>]*color:#E8843A/);
  assert.match(result, /s05-number[^>]*font-family:Georgia, serif/);
  assert.match(result, /s05-number[^>]*font-weight:800/);
  assert.match(result, /s05-number[^>]*left:20px/);
  assert.match(result, /s05-number[^>]*color:#1479FF/);
  assert.match(result, /s05-copy[^>]*font-family:Times New Roman/);
  assert.equal(inspectSlideHtml(result).html, result);
});

test("unknown semantic roles stay safe and unchanged", () => {
  const source = '<section class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden">' +
    '<span data-element-id="accent" data-element-role="section-accent" style="font-family:Courier New;font-weight:500;color:#E8843A">A</span>' +
    '</section>';
  assert.equal(harmonizePresentationTypography(inspectSlideHtml(source).html, roles), source);
});

test("planner requires model-selected role tokens and prompts spatial self-checks", () => {
  const plan = {
    schemaVersion: 1 as const,
    title: "Role system",
    creativeDirection: {
      palette: "Ink and orange",
      typography: "Editorial serif and sans",
      typographyRoles: roles,
      spacing: "64px outer rhythm",
      shapeLanguage: "Fine rules",
      footerTreatment: "Quiet sources",
      motifs: ["Offset numeral"],
      deckRhythm: "Alternate sparse and dense",
    },
    slides: [{
      id: "slide_01",
      title: "Opening",
      purpose: "Open",
      layout: "Asymmetric editorial opener",
      imageIntent: "",
    }],
  };
  assert.deepEqual(parsePresentationPlan(JSON.stringify(plan)).creativeDirection.typographyRoles, roles);
  assert.throws(() => parsePresentationPlan(JSON.stringify({
    ...plan,
    creativeDirection: { ...plan.creativeDirection, typographyRoles: undefined },
  })), (error: unknown) => errorCode(error) === "MODEL_RESPONSE_INVALID");

  const planningPrompt = String(buildPlanningMessages({
    prompt: "A deck",
    direction: "editorial",
    imageMode: "none",
  })[0]?.content);
  const generationPrompt = String(buildGenerationMessages({
    title: "A deck",
    prompt: "A deck",
    direction: "editorial",
    imageMode: "none",
    plan: plan.slides,
  })[0]?.content);
  assert.match(planningPrompt, /typographyRoles/);
  assert.match(planningPrompt, /Do not fall back to a generic house palette/);
  assert.match(generationPrompt, /data-element-role/);
  assert.match(generationPrompt, /partition each slide into explicit text and visual zones/);
  assert.match(generationPrompt, /connectors reach the intended anchors/);
});
