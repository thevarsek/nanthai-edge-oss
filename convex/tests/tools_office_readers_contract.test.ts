import assert from "node:assert/strict";
import test from "node:test";

import JSZip from "jszip";

import { extractDocxContent } from "../tools/docx_reader";
import { extractPptxContent } from "../tools/pptx_reader";
import { extractXlsx } from "../tools/xlsx_reader";

async function buildDocxFixture(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Quarterly Review</w:t></w:r></w:p>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Overview</w:t></w:r></w:p>
        <w:p><w:r><w:t>Revenue &amp; margin improved.</w:t></w:r></w:p>
        <w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:r><w:t>Ship mobile improvements</w:t></w:r></w:p>
      </w:body>
    </w:document>`);
  return zip.generateAsync({ type: "arraybuffer" });
}

async function buildXlsxFixture(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets>
        <sheet name="Summary" sheetId="1" r:id="rId1"/>
      </sheets>
    </workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
    </Relationships>`);
  zip.file("xl/sharedStrings.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <sst>
      <si><t>Name</t></si>
      <si><t>Score</t></si>
      <si><t>Active</t></si>
      <si><t>Alice</t></si>
    </sst>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet>
      <sheetData>
        <row r="1">
          <c r="A1" t="s"><v>0</v></c>
          <c r="B1" t="s"><v>1</v></c>
          <c r="C1" t="s"><v>2</v></c>
        </row>
        <row r="2">
          <c r="A2" t="s"><v>3</v></c>
          <c r="B2"><v>42</v></c>
          <c r="C2" t="b"><v>1</v></c>
        </row>
        <row r="3">
          <c r="A3" t="inlineStr"><is><t>Bob</t></is></c>
          <c r="B3"><f>SUM(B2:B2)</f></c>
          <c r="C3" t="b"><v>0</v></c>
        </row>
      </sheetData>
    </worksheet>`);
  return zip.generateAsync({ type: "arraybuffer" });
}

async function buildPptxFixture(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldIdLst>
        <p:sldId id="256" r:id="rId1"/>
        <p:sldId id="257" r:id="rId2"/>
      </p:sldIdLst>
    </p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Target="slides/slide1.xml"/>
      <Relationship Id="rId2" Target="slides/slide2.xml"/>
    </Relationships>`);
  zip.file("ppt/slides/slide1.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree>
        <p:sp>
          <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
          <p:txBody><a:p><a:r><a:t>Board Review</a:t></a:r></a:p></p:txBody>
        </p:sp>
        <p:sp>
          <p:nvSpPr><p:nvPr><p:ph type="subtitle"/></p:nvPr></p:nvSpPr>
          <p:txBody><a:p><a:r><a:t>Q2 highlights</a:t></a:r></a:p></p:txBody>
        </p:sp>
        <p:sp>
          <p:txBody><a:p><a:r><a:t>Revenue up 20%</a:t></a:r></a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld>
    </p:sld>`);
  zip.file("ppt/slides/slide2.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree>
        <p:sp>
          <p:txBody>
            <a:p><a:r><a:t>Fallback title</a:t></a:r></a:p>
            <a:p><a:r><a:t>First body point</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      </p:spTree></p:cSld>
    </p:sld>`);
  zip.file("ppt/slides/_rels/slide2.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rNote1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide2.xml"/>
    </Relationships>`);
  zip.file("ppt/notesSlides/notesSlide2.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree>
        <p:sp><p:txBody><a:p><a:r><a:t>Speaker note text</a:t></a:r></a:p></p:txBody></p:sp>
      </p:spTree></p:cSld>
    </p:notes>`);
  return zip.generateAsync({ type: "arraybuffer" });
}

test("extractDocxContent builds paragraphs, text, markdown, and word count", async () => {
  const result = await extractDocxContent(await buildDocxFixture());

  assert.equal(result.paragraphs.length, 4);
  assert.equal(result.paragraphs[0].style, "Title");
  assert.match(result.text, /Revenue & margin improved\./);
  assert.match(result.markdown, /^# Quarterly Review/m);
  assert.match(result.markdown, /^## Overview/m);
  assert.match(result.markdown, /^- Ship mobile improvements/m);
  assert.ok(result.wordCount >= 8);
});

test("extractXlsx resolves shared strings, booleans, formulas, and markdown tables", async () => {
  const result = await extractXlsx(await buildXlsxFixture());

  assert.equal(result.sheets.length, 1);
  assert.equal(result.sheets[0].name, "Summary");
  assert.deepEqual(result.sheets[0].headers, ["Name", "Score", "Active"]);
  assert.deepEqual(result.sheets[0].rows, [
    ["Alice", 42, true],
    ["Bob", "=SUM(B2:B2)", false],
  ]);
  assert.match(result.markdown, /^## Summary/m);
  assert.match(result.markdown, /\| Name \| Score \| Active \|/);
});

test("extractPptxContent resolves titles, subtitles, notes, and fallback title logic", async () => {
  const result = await extractPptxContent(await buildPptxFixture());

  assert.equal(result.slideCount, 2);
  assert.equal(result.slides[0].title, "Board Review");
  assert.equal(result.slides[0].bodyParagraphs[0].role, "subtitle");
  assert.equal(result.slides[1].title, "Fallback title");
  assert.equal(result.slides[1].notesText, "Speaker note text");
  assert.match(result.markdown, /^## Slide 1: Board Review/m);
  assert.match(result.markdown, /\> \*\*Notes:\*\* Speaker note text/);
  assert.ok(result.wordCount >= 8);
});
