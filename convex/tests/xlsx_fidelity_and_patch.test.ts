import assert from "node:assert/strict";
import test from "node:test";

import JSZip from "jszip";

import { patchXlsxBlob } from "../tools/xlsx_patcher";
import { validateXlsxPackage } from "../tools/xlsx_qa";
import { extractXlsx } from "../tools/xlsx_reader";
import { normalizeXlsxOptions } from "../tools/xlsx_validation";
import { buildXlsxBlob } from "../tools/xlsx_writer";

async function readerFixture(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", `<workbook xmlns:r="relationships"><workbookPr date1904="0"/><sheets>` +
    `<sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<Relationships>` +
    `<Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`);
  zip.file("xl/sharedStrings.xml", `<sst count="2" uniqueCount="2">` +
    `<si><r><t xml:space="preserve">Run </t></r><r><t>Text</t></r></si>` +
    `<si><t xml:space="preserve">00123</t></si></sst>`);
  zip.file("xl/styles.xml", `<styleSheet><numFmts count="0"/><cellXfs count="2">` +
    `<xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`);
  zip.file("xl/worksheets/sheet1.xml", `<worksheet><sheetData>` +
    `<row r="1"><c r="A1" t="inlineStr"><is><t>Label</t></is></c>` +
    `<c r="B1" t="inlineStr"><is><t>ID</t></is></c>` +
    `<c r="C1" t="inlineStr"><is><t>Total</t></is></c>` +
    `<c r="D1" t="inlineStr"><is><t>Date</t></is></c></row>` +
    `<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c>` +
    `<c r="C2"><f t="shared" si="0" ref="C2:C3">SUM(A2:B2)</f><v>7</v></c>` +
    `<c r="D2" s="1"><v>45292</v></c></row>` +
    `<row r="3"><c r="A3" t="inlineStr"><is><t>Other</t></is></c><c r="B3"><v>1</v></c>` +
    `<c r="C3"><f t="shared" si="0"/><v>8</v></c><c r="D3" s="1"><v>60</v></c></row>` +
    `</sheetData></worksheet>`);
  return zip.generateAsync({ type: "arraybuffer" });
}

test("extractXlsx preserves rich text, identifiers, formula text, cached values, and dates", async () => {
  const source = await readerFixture();
  const formulas = await extractXlsx(source);
  const values = await extractXlsx(source, { includeFormulas: false });

  assert.deepEqual(formulas.sheets[0].rows[0], ["Run Text", "00123", "=SUM(A2:B2)", "2024-01-01"]);
  assert.deepEqual(values.sheets[0].rows[0], ["Run Text", "00123", 7, "2024-01-01"]);
  assert.deepEqual(formulas.sheets[0].rows[1], ["Other", 1, "=SUM(A3:B3)", "1900-02-29"]);
});

test("extractXlsx bounds default reads and supports range pagination and search", async () => {
  const rows = Array.from({ length: 205 }, (_, index) => [
    index + 1,
    index === 149 ? "needle" : `Item ${index + 1}`,
  ]);
  const blob = await buildXlsxBlob({
    title: "Large",
    sheets: [{ name: "Data", headers: ["Index", "Label"], rows }],
  });

  const defaultRead = await extractXlsx(await blob.arrayBuffer());
  assert.equal(defaultRead.sheets[0].returnedRows, 200);
  assert.equal(defaultRead.sheets[0].hasMore, true);
  assert.equal(defaultRead.sheets[0].nextOffset, 200);

  const page = await extractXlsx(await blob.arrayBuffer(), {
    sheet: "data",
    range: "A1:B206",
    offset: 10,
    limit: 5,
  });
  assert.deepEqual(page.sheets[0].rowNumbers, [12, 13, 14, 15, 16]);
  assert.equal(page.sheets[0].range, "A1:B16");

  const search = await extractXlsx(await blob.arrayBuffer(), { search: "NEEDLE" });
  assert.equal(search.sheets[0].totalRows, 1);
  assert.deepEqual(search.sheets[0].rowNumbers, [151]);
});

test("normalizeXlsxOptions validates workbook rules without coercing text", () => {
  const workbook = normalizeXlsxOptions({
    title: "Rules",
    sheets: [{
      name: "Data",
      headers: ["ID", "Value"],
      rows: [["00123", 10]],
      conditionalFormats: [{
        range: "B2:B100",
        operator: "between",
        formula: "0",
        formula2: "100",
        bgColor: "C6EFCE",
      }],
      dataValidations: [{
        range: "A2:A100",
        type: "textLength",
        operator: "equal",
        formula1: "5",
      }],
    }],
    namedRanges: [{ name: "Values", range: "Data!B2:B100" }],
  });
  assert.equal(workbook.sheets[0].rows[0][0], "00123");

  assert.throws(() => normalizeXlsxOptions({
    title: "Invalid",
    sheets: [{
      name: "Data",
      headers: ["Value"],
      rows: [[1]],
      conditionalFormats: [{ range: "A2:A3", operator: "between", formula: "0" }],
    }],
  }), /conditionalFormats/);
  assert.throws(() => normalizeXlsxOptions({
    title: "Duplicate",
    sheets: [
      { name: "A/B", headers: ["Value"], rows: [] },
      { name: "A?B", headers: ["Value"], rows: [] },
    ],
  }), /unique/);
});

test("patchXlsxBlob preserves unsupported parts and workbook features while editing cells", async () => {
  const original = await buildXlsxBlob({
    title: "Patch",
    namedRanges: [{ name: "Amounts", range: "Data!B2:B3" }],
    sheets: [
      {
        name: "Data",
        headers: ["Name", "Amount", "Status"],
        rows: [["Alpha", 100, "Open"], ["Beta", 200, "Closed"]],
        columnFormats: [{ column: 1, format: "$#,##0" }],
        cellStyles: [{ range: "C2:C3", bgColor: "FFF9C4" }],
        dataValidations: [{ range: "C2:C100", type: "list", formula1: `"Open,Closed"` }],
      },
      { name: "Archive", headers: ["Name"], rows: [["Old"]] },
    ],
  });
  const sourceZip = await JSZip.loadAsync(await original.arrayBuffer());
  const sourceWorkbook = await sourceZip.file("xl/workbook.xml")!.async("string");
  sourceZip.file("xl/workbook.xml", sourceWorkbook.replace(
    `name="Archive" sheetId="2"`,
    `name="Archive" state="hidden" sheetId="2"`,
  ));
  const relationships = await sourceZip.file("xl/_rels/workbook.xml.rels")!.async("string");
  sourceZip.file("xl/_rels/workbook.xml.rels", relationships.replace(
    "</Relationships>",
    `<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>`,
  ));
  const contentTypes = await sourceZip.file("[Content_Types].xml")!.async("string");
  sourceZip.file("[Content_Types].xml", contentTypes.replace(
    "</Types>",
    `<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>`,
  ));
  sourceZip.file("xl/calcChain.xml", `<calcChain><c r="B2" i="1"/></calcChain>`);
  sourceZip.file(
    "xl/charts/chart1.xml",
    `<c:chart xmlns:c="chart"><c:ser><c:f>Data!$A$2:$A$3</c:f>` +
      `<c:f>[Other.xlsx]Data!$A$1</c:f></c:ser></c:chart>`,
  );
  const sourceSheet = await sourceZip.file("xl/worksheets/sheet1.xml")!.async("string");
  const originalStyle = sourceSheet.match(/<c r="B2"[^>]*s="([^"]+)"/)?.[1];
  const clearedStyle = sourceSheet.match(/<c r="C2"[^>]*s="([^"]+)"/)?.[1];
  assert.ok(originalStyle);
  assert.ok(clearedStyle);

  const source = await sourceZip.generateAsync({ type: "arraybuffer" });
  const patched = await patchXlsxBlob(source, [
    { type: "setCells", sheet: "Data", startCell: "B2", rows: [[99]] },
    { type: "clearRange", sheet: "Data", range: "C2" },
    { type: "appendRows", sheet: "Data", rows: [["Gamma", 300, "Open"]] },
    { type: "renameSheet", sheet: "Data", newName: "Actuals" },
  ]);
  const zip = await JSZip.loadAsync(await patched.arrayBuffer());
  const workbook = await zip.file("xl/workbook.xml")!.async("string");
  const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const chart = await zip.file("xl/charts/chart1.xml")!.async("string");

  assert.match(workbook, /name="Actuals"/);
  assert.match(workbook, /name="Archive" state="hidden"/);
  assert.match(workbook, /<definedName name="Amounts">&apos;Actuals&apos;!B2:B3<\/definedName>/);
  assert.match(workbook, /fullCalcOnLoad="1"/);
  assert.match(sheet, /<dataValidations count="1">/);
  assert.match(sheet, new RegExp(`<c r="B2"[^>]*s="${originalStyle}"`));
  assert.match(sheet, new RegExp(`<c r="C2"[^>]*s="${clearedStyle}"[^>]*/>`));
  assert.match(chart, /&apos;Actuals&apos;!\$A\$2:\$A\$3/);
  assert.match(chart, /\[Other\.xlsx\]Data!\$A\$1/);
  assert.equal(zip.file("xl/calcChain.xml"), null);

  const extracted = await extractXlsx(await patched.arrayBuffer(), { sheet: "Actuals" });
  assert.deepEqual(extracted.sheets[0].rows, [
    ["Alpha", 99, null],
    ["Beta", 200, "Closed"],
    ["Gamma", 300, "Open"],
  ]);
  const validation = await validateXlsxPackage(patched);
  assert.equal(validation.sheetCount, 2);
  assert.equal(validation.recalculatesOnOpen, true);
});
