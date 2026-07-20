import assert from "node:assert/strict";
import test from "node:test";

import JSZip from "jszip";

import { extractXlsx } from "../tools/xlsx_reader";

async function makeZipBuffer(zip: JSZip): Promise<ArrayBuffer> {
  return zip.generateAsync({ type: "arraybuffer" });
}

async function buildSparseLargeWorkbook(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets>
        <sheet name="Data &amp; Ops" sheetId="1" r:id="rId1"/>
        <sheet name="Missing Target" sheetId="2" r:id="rId2"/>
        <sheet name="Missing Xml" sheetId="3" r:id="rId3"/>
        <sheet name="Empty" sheetId="4" r:id="rId4"/>
      </sheets>
    </workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/>
      <Relationship Id="rId3" Target="worksheets/missing.xml"/>
      <Relationship Id="rId4" Target="worksheets/empty.xml"/>
    </Relationships>`);
  zip.file("xl/sharedStrings.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <sst>
      <si><t>Shared &amp; Text</t></si>
      <si><r><t>Run </t></r><r><t>Text</t></r></si>
    </sst>`);

  const generatedRows = Array.from({ length: 21 }, (_, index) => {
    const row = index + 3;
    return `<row r="${row}">
      <c r="A${row}" t="inlineStr"><is><t>Item ${row}</t></is></c>
      <c r="B${row}"><v>${row}</v></c>
      <c r="C${row}" t="b"><v>${row % 2 === 0 ? "1" : "0"}</v></c>
    </row>`;
  }).join("\n");

  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet>
      <sheetData>
        <row r="1">
          <c r="A1" t="inlineStr"><is><t>Name</t></is></c>
          <c r="B1" t="inlineStr"><is><t>Count</t></is></c>
          <c r="C1" t="inlineStr"><is><t>Flag</t></is></c>
          <c r="D1" t="inlineStr"><is><t>Formula</t></is></c>
          <c r="E1" t="inlineStr"><is><t>Raw</t></is></c>
        </row>
        <row r="2">
          <c r="A2" t="s"><v>0</v></c>
          <c r="B2"><v>7</v></c>
          <c r="C2" t="b"><v>0</v></c>
          <c r="D2"><f>SUM(B2:B2)</f></c>
          <c r="E2"><v>not-a-number</v></c>
          <c r="BAD"><v>ignored invalid ref</v></c>
          <c><v>ignored missing ref</v></c>
        </row>
        ${generatedRows}
      </sheetData>
    </worksheet>`);
  zip.file("xl/worksheets/empty.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet><sheetData></sheetData></worksheet>`);
  return makeZipBuffer(zip);
}

test("extractXlsx reports invalid workbooks without inventing sheets", async () => {
  const zip = new JSZip();
  zip.file("xl/sharedStrings.xml", "<sst><si><t>Orphan</t></si></sst>");

  const result = await extractXlsx(await makeZipBuffer(zip));

  assert.deepEqual(result.sheets, []);
  assert.equal(result.markdown, "(Empty or invalid .xlsx file)");
});

test("extractXlsx skips broken relationships while preserving sparse large-sheet data", async () => {
  const result = await extractXlsx(await buildSparseLargeWorkbook());

  assert.equal(result.sheets.length, 2);
  assert.equal(result.sheets[0].name, "Data & Ops");
  assert.equal(result.sheets[0].totalRows, 22);
  assert.equal(result.sheets[0].totalCols, 5);
  assert.deepEqual(result.sheets[0].headers, ["Name", "Count", "Flag", "Formula", "Raw"]);
  assert.deepEqual(result.sheets[0].rows[0], [
    "Shared & Text",
    7,
    false,
    "=SUM(B2:B2)",
    "not-a-number",
  ]);
  assert.deepEqual(result.sheets[1], {
    name: "Empty",
    state: undefined,
    headers: [],
    rows: [],
    rowNumbers: [],
    totalRows: 0,
    totalCols: 0,
    returnedRows: 0,
    offset: 0,
    hasMore: false,
    range: "A1:A1",
  });
  assert.match(result.markdown, /^## Data & Ops/m);
  assert.match(result.markdown, /\| Shared & Text \| 7 \| false \| =SUM\(B2:B2\) \| not-a-number \|/);
  assert.match(result.markdown, /\*\.\.\. 2 more returned rows\*/);
  assert.doesNotMatch(result.markdown, /Missing Target/);
  assert.doesNotMatch(result.markdown, /Missing Xml/);
});
