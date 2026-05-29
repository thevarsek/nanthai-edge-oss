import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  applyTrackedDocxEdits,
  extractAcceptedDocxText,
  extractReviewDocxParagraphs,
  resolveTrackedDocxChange,
} from "../documents/docx_tracked_changes";

const NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function run(text: string): string {
  return `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function formattedRun(text: string, runProperties: string): string {
  return `<w:r><w:rPr>${runProperties}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
}

async function docx(body: string, path = "word/document.xml"): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>");
  zip.file(path, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${NS}"><w:body>${body}</w:body></w:document>`);
  return await zip.generateAsync({ type: "arraybuffer" });
}

async function documentXml(bytes: ArrayBuffer, path = "word/document.xml"): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return await zip.file(path)!.async("string");
}

test("DOCX tracked changes replaces text split across runs", async () => {
  const bytes = await docx(`<w:p>${run("Hello ")}${run("world")}</w:p>`);
  const result = await applyTrackedDocxEdits(bytes, [{
    find: "Hello world",
    replace: "Hello counsel",
    contextBefore: "",
    contextAfter: "",
  }], { author: "NanthAI", now: 1, seed: "v1" });

  assert.equal(result.errors.length, 0);
  assert.equal(result.changes.length, 1);
  const xml = await documentXml(result.bytes);
  assert.match(xml, /w:del/);
  assert.match(xml, /w:ins/);
  assert.match(xml, /Hello counsel/);
  assert.equal((await extractAcceptedDocxText(result.bytes)).text, "Hello counsel");
});

test("DOCX tracked changes inserts, deletes, and emits multiline breaks", async () => {
  const bytes = await docx(`<w:p>${run("Alpha Gamma")}</w:p><w:p>${run("Delete me")}</w:p><w:p>${run("Line one")}</w:p>`);
  const result = await applyTrackedDocxEdits(bytes, [
    { find: "", replace: " Beta", contextBefore: "Alpha", contextAfter: " Gamma" },
    { find: "Delete me", replace: "", contextBefore: "", contextAfter: "" },
    { find: "Line one", replace: "Line one\nLine two", contextBefore: "", contextAfter: "" },
  ], { author: "NanthAI", now: 1, seed: "v2" });

  assert.equal(result.errors.length, 0);
  assert.equal(result.changes.length, 3);
  const xml = await documentXml(result.bytes);
  assert.match(xml, /w:br/);
  assert.equal((await extractAcceptedDocxText(result.bytes)).text, "Alpha Beta Gamma\nLine one\nLine two");
});

test("DOCX tracked changes preserves leading and trailing whitespace while locating edits", async () => {
  const bytes = await docx(`<w:p>${run("  Seller shall pay.  ")}</w:p>`);
  const result = await applyTrackedDocxEdits(bytes, [{
    find: "Seller",
    replace: "Buyer",
    contextBefore: "",
    contextAfter: "shall pay",
  }], { author: "NanthAI", now: 1, seed: "v2-spaces" });

  assert.equal(result.errors.length, 0);
  assert.equal(result.changes[0]?.deletedText, "Seller");
  assert.equal((await extractAcceptedDocxText(result.bytes)).text, "  Buyer shall pay.  ");
});

test("DOCX tracked changes maps trailing-space context without shifting replacement spans", async () => {
  const bytes = await docx(`<w:p>${run("Buyer shall pay.  ")}</w:p>`);
  const result = await applyTrackedDocxEdits(bytes, [{
    find: "pay.",
    replace: "remit.",
    contextBefore: "shall",
    contextAfter: "",
  }], { author: "NanthAI", now: 1, seed: "v2-trailing-spaces" });

  assert.equal(result.errors.length, 0);
  assert.equal(result.changes[0]?.deletedText, "pay.");
  assert.equal((await extractAcceptedDocxText(result.bytes)).text, "Buyer shall remit.  ");
});

test("DOCX tracked changes inserts after trailing context before preserved paragraph whitespace", async () => {
  const bytes = await docx(`<w:p>${run("Buyer shall pay.  ")}</w:p>`);
  const result = await applyTrackedDocxEdits(bytes, [{
    find: "",
    replace: " promptly",
    contextBefore: "pay.",
    contextAfter: "",
  }], { author: "NanthAI", now: 1, seed: "v2-trailing-insert" });

  assert.equal(result.errors.length, 0);
  assert.equal(result.changes[0]?.deletedText, "");
  assert.equal((await extractAcceptedDocxText(result.bytes)).text, "Buyer shall pay. promptly  ");
});

test("DOCX tracked changes traverses tables and content controls", async () => {
  const bytes = await docx(`
    <w:tbl><w:tr><w:tc><w:p>${run("Table term")}</w:p></w:tc></w:tr></w:tbl>
    <w:sdt><w:sdtContent><w:p>${run("Control term")}</w:p></w:sdtContent></w:sdt>
  `);
  const result = await applyTrackedDocxEdits(bytes, [
    { find: "Table term", replace: "Table clause", contextBefore: "", contextAfter: "" },
    { find: "Control term", replace: "Control clause", contextBefore: "", contextAfter: "" },
  ], { author: "NanthAI", now: 1, seed: "v3" });

  assert.equal(result.errors.length, 0);
  assert.equal((await extractAcceptedDocxText(result.bytes)).text, "Table clause\nControl clause");
});

test("DOCX accepted view includes existing insertions, skips deletions, and rejects edits through existing changes", async () => {
  const bytes = await docx(`<w:p>${run("A ")}<w:ins w:id="1">${run("visible")}</w:ins><w:del w:id="2"><w:r><w:delText> hidden</w:delText></w:r></w:del></w:p>`);
  assert.equal((await extractAcceptedDocxText(bytes)).text, "A visible");
  const rejected = await applyTrackedDocxEdits(bytes, [{
    find: "A visible",
    replace: "A revised",
    contextBefore: "",
    contextAfter: "",
  }], { author: "NanthAI", now: 1, seed: "v4" });
  assert.equal(rejected.changes.length, 0);
  assert.deepEqual(rejected.errors.map((error) => error.code), ["UNSUPPORTED_DOCX"]);

  const result = await applyTrackedDocxEdits(bytes, [{
    find: "A",
    replace: "The",
    contextBefore: "",
    contextAfter: "visible",
  }], { author: "NanthAI", now: 1, seed: "v4b" });
  assert.equal(result.errors.length, 0);
  assert.equal((await extractAcceptedDocxText(result.bytes)).text, "The visible");
});

test("DOCX review preview exposes inserted and deleted tracked-change segments", async () => {
  const bytes = await docx(`<w:p>${run("A ")}<w:del w:id="1"><w:r><w:delText>seller</w:delText></w:r></w:del><w:ins w:id="2">${run("buyer")}</w:ins>${run(" clause")}</w:p>`);
  const preview = await extractReviewDocxParagraphs(bytes);

  assert.deepEqual(preview.paragraphs[0]?.segments, [
    { kind: "normal", text: "A " },
    { kind: "deleted", text: "seller" },
    { kind: "inserted", text: "buyer" },
    { kind: "normal", text: " clause" },
  ]);
});

test("DOCX tracked changes reports ambiguous, missing, pure insert, and overlap errors", async () => {
  const bytes = await docx(`<w:p>${run("One fish. One fish.")}</w:p><w:p>${run("Overlap target")}</w:p>`);
  const result = await applyTrackedDocxEdits(bytes, [
    { find: "One fish", replace: "Two fish", contextBefore: "", contextAfter: "" },
    { find: "Missing", replace: "Found", contextBefore: "", contextAfter: "" },
    { find: "", replace: "No anchor", contextBefore: "", contextAfter: "" },
    { find: "Overlap target", replace: "Replacement", contextBefore: "", contextAfter: "" },
    { find: "target", replace: "term", contextBefore: "Overlap ", contextAfter: "" },
  ], { author: "NanthAI", now: 1, seed: "v5" });

  assert.deepEqual(result.errors.map((error) => error.code), [
    "MATCH_AMBIGUOUS",
    "MATCH_NOT_FOUND",
    "PURE_INSERT_REQUIRES_CONTEXT",
    "OVERLAPPING_EDIT",
  ]);
});

test("DOCX tracked changes accepts and rejects wrappers", async () => {
  const bytes = await docx(`<w:p>${run("Pay seller")}</w:p>`);
  const proposed = await applyTrackedDocxEdits(bytes, [{
    find: "seller",
    replace: "buyer",
    contextBefore: "Pay ",
    contextAfter: "",
  }], { author: "NanthAI", now: 1, seed: "v6" });
  const changeId = proposed.changes[0]!.changeId;

  const accepted = await resolveTrackedDocxChange(proposed.bytes, [changeId], "accept");
  assert.equal(accepted.found, true);
  assert.equal((await extractAcceptedDocxText(accepted.bytes)).text, "Pay buyer");

  const rejected = await resolveTrackedDocxChange(proposed.bytes, [changeId], "reject");
  assert.equal(rejected.found, true);
  assert.equal((await extractAcceptedDocxText(rejected.bytes)).text, "Pay seller");
});

test("DOCX tracked changes reports missing wrappers during resolution", async () => {
  const bytes = await docx(`<w:p>${run("No pending changes")}</w:p>`);
  const resolved = await resolveTrackedDocxChange(bytes, ["missing-change"], "accept");

  assert.equal(resolved.found, false);
  assert.equal(await documentXml(resolved.bytes), await documentXml(bytes));
});

test("DOCX tracked changes preserves backslash document.xml zip paths", async () => {
  const bytes = await docx(`<w:p>${run("Backslash path")}</w:p>`, "word\\document.xml");
  const result = await applyTrackedDocxEdits(bytes, [{
    find: "path",
    replace: "entry",
    contextBefore: "Backslash ",
    contextAfter: "",
  }], { author: "NanthAI", now: 1, seed: "v7" });
  const zip = await JSZip.loadAsync(result.bytes);
  assert.ok(zip.file("word\\document.xml"));
  assert.equal((await extractAcceptedDocxText(result.bytes)).text, "Backslash entry");
});

test("DOCX tracked changes preserves package validity, declarations, and untouched parts", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>");
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${NS}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run("Change this term")}</w:p></w:body></w:document>`);
  zip.file("word/header1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${NS}"><w:p>${run("Header term")}</w:p></w:hdr>`);
  const bytes = await zip.generateAsync({ type: "arraybuffer" });

  const result = await applyTrackedDocxEdits(bytes, [{
    find: "term",
    replace: "clause",
    contextBefore: "Change this ",
    contextAfter: "",
  }], { author: "NanthAI", now: 1, seed: "v8" });

  const outputZip = await JSZip.loadAsync(result.bytes);
  const xml = await outputZip.file("word/document.xml")!.async("string");
  const header = await outputZip.file("word/header1.xml")!.async("string");
  assert.match(xml, /^<\?xml/);
  assert.match(xml, /w:pStyle w:val="Heading1"/);
  assert.match(header, /Header term/);
  assert.equal((await extractAcceptedDocxText(result.bytes)).text, "Change this clause");
});

test("DOCX tracked changes keeps paragraph properties before beginning insertions", async () => {
  const bytes = await docx(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run("Agreement title")}</w:p>`);
  const result = await applyTrackedDocxEdits(bytes, [{
    find: "",
    replace: "Draft ",
    contextBefore: "",
    contextAfter: "Agreement title",
  }], { author: "NanthAI", now: 1, seed: "v8-beginning-insert" });

  assert.equal(result.errors.length, 0);
  const xml = await documentXml(result.bytes);
  assert.match(xml, /<w:p><w:pPr>[\s\S]*<\/w:pPr><w:ins\b/);
  assert.equal((await extractAcceptedDocxText(result.bytes)).text, "Draft Agreement title");
});

test("DOCX tracked changes preserves run formatting on replacement wrappers", async () => {
  const bytes = await docx(`<w:p>${run("Plain ")}${formattedRun("italic term", "<w:i/><w:rStyle w:val=\"Emphasis\"/>")}${formattedRun(" underlined", "<w:u w:val=\"single\"/>")}</w:p>`);
  const result = await applyTrackedDocxEdits(bytes, [{
    find: "italic term",
    replace: "italic clause",
    contextBefore: "Plain ",
    contextAfter: " underlined",
  }], { author: "NanthAI", now: 1, seed: "v9" });

  assert.equal(result.errors.length, 0);
  const xml = await documentXml(result.bytes);
  assert.match(xml, /<w:del\b[\s\S]*<w:i><\/w:i>[\s\S]*<w:rStyle w:val="Emphasis"><\/w:rStyle>[\s\S]*<w:delText[^>]*>italic term<\/w:delText>[\s\S]*<\/w:del>/);
  assert.match(xml, /<w:ins\b[\s\S]*<w:i><\/w:i>[\s\S]*<w:rStyle w:val="Emphasis"><\/w:rStyle>[\s\S]*<w:t[^>]*>italic clause<\/w:t>[\s\S]*<\/w:ins>/);
  assert.match(xml, /<w:r><w:rPr><w:u w:val="single"><\/w:u><\/w:rPr><w:t xml:space="preserve"> underlined<\/w:t><\/w:r>/);
  assert.equal((await extractAcceptedDocxText(result.bytes)).text, "Plain italic clause underlined");
});

test("DOCX tracked changes splits formatted runs without losing bold formatting", async () => {
  const bytes = await docx(`<w:p>${formattedRun("bold target text", "<w:b/>")}</w:p>`);
  const result = await applyTrackedDocxEdits(bytes, [{
    find: "target",
    replace: "clause",
    contextBefore: "bold ",
    contextAfter: " text",
  }], { author: "NanthAI", now: 1, seed: "v10" });

  assert.equal(result.errors.length, 0);
  const xml = await documentXml(result.bytes);
  assert.match(xml, /<w:t xml:space="preserve">bold <\/w:t>/);
  assert.match(xml, /<w:del\b[\s\S]*<w:b><\/w:b>[\s\S]*<w:delText[^>]*>target<\/w:delText>[\s\S]*<\/w:del>/);
  assert.match(xml, /<w:ins\b[\s\S]*<w:b><\/w:b>[\s\S]*<w:t[^>]*>clause<\/w:t>[\s\S]*<\/w:ins>/);
  assert.match(xml, /<w:t xml:space="preserve"> text<\/w:t>/);
  assert.equal((await extractAcceptedDocxText(result.bytes)).text, "bold clause text");
});

test("DOCX tracked changes rejects rich inline structures instead of normalizing them", async () => {
  const bytes = await docx(`<w:p>${run("Start ")}<w:hyperlink w:anchor="target">${run("linked term")}</w:hyperlink>${run(" end")}</w:p>`);
  const result = await applyTrackedDocxEdits(bytes, [{
    find: "linked term",
    replace: "linked clause",
    contextBefore: "Start ",
    contextAfter: " end",
  }], { author: "NanthAI", now: 1, seed: "v11" });

  assert.equal(result.changes.length, 0);
  assert.deepEqual(result.errors.map((error) => error.code), ["UNSUPPORTED_DOCX"]);
  assert.equal(await documentXml(result.bytes), await documentXml(bytes));
});
