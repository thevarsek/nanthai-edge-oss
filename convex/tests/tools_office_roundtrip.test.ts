import assert from "node:assert/strict";
import test from "node:test";

import JSZip from "jszip";

import { buildXlsxBlob } from "../tools/xlsx_writer";
import { editDocx } from "../tools/edit_docx";
import { editPptx } from "../tools/edit_pptx";
import { editXlsx } from "../tools/edit_xlsx";
import { generateDocx } from "../tools/generate_docx";
import { generatePptx } from "../tools/generate_pptx";
import { generateXlsx } from "../tools/generate_xlsx";
import { readDocx } from "../tools/read_docx";
import { readPptx } from "../tools/read_pptx";
import { readXlsx } from "../tools/read_xlsx";

function createStorageHarness() {
  const files = new Map<string, Blob>();
  let nextId = 1;
  const storage = {
    store: async (blob: Blob) => {
      const id = `storage_${nextId++}`;
      files.set(id, blob);
      return id as any;
    },
    get: async (id: string) => files.get(id) ?? null,
    getUrl: async (id: string) => `https://files.example/${id}`,
  };
  return {
    files,
    storage,
    toolCtx: { userId: "user_1", ctx: { storage } } as any,
  };
}

async function unzipBlob(blob: Blob) {
  return JSZip.loadAsync(await blob.arrayBuffer());
}

test("buildXlsxBlob writes formulas, styles, merges, and named ranges into OOXML", async () => {
  const blob = await buildXlsxBlob({
    title: "Workbook",
    namedRanges: [{ name: "Revenue", range: "Summary!B2:B3" }],
    sheets: [{
      name: "Summary",
      headers: ["Name", "Revenue", "Active", "Formula"],
      rows: [
        ["Acme", 1234.5, true, "=SUM(B2:B2)"],
        ["Beta", 987, false, null],
      ],
      columnWidths: [18, 12, 10, 14],
      columnFormats: [{ column: 1, format: "$#,##0.00" }],
      cellStyles: [
        { range: "A2:A3", bold: true, fontColor: "FF0000", bgColor: "FFFF00", borderStyle: "thin" },
        { range: "B2:B3", numberFormat: "$#,##0.00" },
      ],
      mergedCells: ["A1:D1"],
    }],
  });

  const zip = await unzipBlob(blob);
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  const sheetXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
  const stylesXml = await zip.file("xl/styles.xml")?.async("string");

  assert.match(workbookXml ?? "", /definedName name="Revenue"/);
  assert.match(workbookXml ?? "", /Summary!B2:B3/);
  assert.match(sheetXml ?? "", /mergeCell ref="A1:D1"/);
  assert.match(sheetXml ?? "", /<f>SUM\(B2:B2\)<\/f>/);
  assert.match(stylesXml ?? "", /formatCode="\$#,\#\#0\.00"/);
  assert.match(stylesXml ?? "", /applyNumberFormat="1"/);
});

test("generateXlsx and readXlsx round-trip sanitized workbook content", async () => {
  const harness = createStorageHarness();
  const generated = await generateXlsx.execute(harness.toolCtx, {
    title: "Ops / Scorecard",
    sheets: [{
      name: "Ops/Plan*2026",
      headers: ["Owner", "Points", "Active"],
      rows: [
        ["Alice", "42", true],
        ["Bob", "3.5", false],
      ],
    }],
  });

  assert.equal(generated.success, true);
  assert.equal((generated.data as any).filename, "Ops  Scorecard.xlsx");

  const readBack = await readXlsx.execute(harness.toolCtx, {
    storageId: (generated.data as any).storageId,
  });

  assert.equal(readBack.success, true);
  assert.equal((readBack.data as any).sheetCount, 1);
  assert.equal((readBack.data as any).sheets[0].name, "Ops_Plan_2026");
  assert.deepEqual((readBack.data as any).sheets[0].rows, [
    ["Alice", 42, true],
    ["Bob", 3.5, false],
  ]);
});

test("editXlsx verifies the original workbook and stores a regenerated version", async () => {
  const harness = createStorageHarness();
  const original = await generateXlsx.execute(harness.toolCtx, {
    title: "Original workbook",
    sheets: [{
      name: "Sheet1",
      headers: ["Item", "Value"],
      rows: [["Base", 10]],
    }],
  });

  const edited = await editXlsx.execute(harness.toolCtx, {
    storageId: (original.data as any).storageId,
    title: "Finance Update",
    sheets: [{
      name: "Summary",
      headers: ["Item", "Value", "Formula"],
      rows: [["Revenue", 25, "=SUM(B2:B2)"]],
      mergedCells: ["A1:C1"],
    }],
    namedRanges: [{ name: "RevenueCell", range: "Summary!B2:B2" }],
  });

  assert.equal(edited.success, true);
  assert.equal((edited.data as any).originalStorageId, (original.data as any).storageId);

  const reread = await readXlsx.execute(harness.toolCtx, {
    storageId: (edited.data as any).storageId,
  });

  assert.equal(reread.success, true);
  assert.deepEqual((reread.data as any).sheets[0].headers, ["Item", "Value", "Formula"]);
  assert.deepEqual((reread.data as any).sheets[0].rows, [
    ["Revenue", 25, "=SUM(B2:B2)"],
  ]);
});

test("generateDocx creates a readable document with TOC, header, footer, and tables", async () => {
  const harness = createStorageHarness();
  const generated = await generateDocx.execute(harness.toolCtx, {
    title: "Quarterly / Review",
    includeToc: true,
    headerText: "Confidential",
    showPageNumbers: true,
    sections: [
      {
        heading: "Overview",
        body: "This is the **overview**.\nIt has *formatting*.",
      },
      {
        heading: "Metrics",
        headingLevel: 2,
        body: "Key metrics table follows.",
        table: {
          headers: ["Metric", "Value"],
          rows: [["Revenue", "$10"], ["Margin", "24%"]],
        },
      },
    ],
  });

  assert.equal(generated.success, true);
  assert.equal((generated.data as any).filename, "Quarterly  Review.docx");

  const blob = harness.files.get((generated.data as any).storageId);
  assert.ok(blob);
  const zip = await unzipBlob(blob!);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  const footerXml = await zip.file("word/footer1.xml")?.async("string");

  assert.match(documentXml ?? "", /Table of Contents/);
  assert.match(documentXml ?? "", /Overview/);
  assert.match(documentXml ?? "", /Metrics/);
  assert.match(footerXml ?? "", /PAGE/);

  const readBack = await readDocx.execute(harness.toolCtx, {
    storageId: (generated.data as any).storageId,
  });

  assert.equal(readBack.success, true);
  assert.match(String((readBack.data as any).text), /overview/i);
  assert.match(String((readBack.data as any).text), /Revenue/);
  assert.ok((readBack.data as any).wordCount > 0);
});

test("editDocx regenerates the document and reports old and new word counts", async () => {
  const harness = createStorageHarness();
  const original = await generateDocx.execute(harness.toolCtx, {
    title: "Source doc",
    sections: [{
      heading: "Original",
      body: "This is the original document body.",
    }],
  });

  const edited = await editDocx.execute(harness.toolCtx, {
    storageId: (original.data as any).storageId,
    title: "Updated / Doc",
    includeToc: true,
    sections: [{
      heading: "Updated",
      headingLevel: 2,
      body: "This updated version adds more detail and a table.",
      table: {
        headers: ["Step", "Owner"],
        rows: [["Plan", "Dino"]],
      },
    }],
  });

  assert.equal(edited.success, true);
  assert.ok((edited.data as any).originalWordCount > 0);
  assert.ok((edited.data as any).newWordCount > 0);

  const readBack = await readDocx.execute(harness.toolCtx, {
    storageId: (edited.data as any).newStorageId,
  });

  assert.equal(readBack.success, true);
  assert.match(String((readBack.data as any).text), /updated version/i);
  assert.doesNotMatch(String((readBack.data as any).text), /original document body/i);
});

test("generatePptx and readPptx round-trip multiple slide layouts and notes", async () => {
  const harness = createStorageHarness();
  const generated = await generatePptx.execute(harness.toolCtx, {
    title: "Board / Review",
    subtitle: "Q2 highlights",
    showSlideNumbers: true,
    slides: [
      {
        title: "Section opener",
        layout: "section",
        body: "Highlights and decisions",
      },
      {
        title: "KPI table",
        layout: "table",
        table: {
          headers: ["Metric", "Value"],
          rows: [["Revenue", "$10M"], ["Margin", "24%"]],
        },
        notes: "Use this slide for the board summary.",
      },
      {
        title: "Growth chart",
        layout: "chart",
        chart: {
          type: "bar",
          labels: ["Jan", "Feb", "Mar"],
          datasets: [{ name: "ARR", values: [10, 12, 15], color: "3366CC" }],
        },
      },
      {
        title: "Split plan",
        layout: "split",
        body: "Left narrative with supporting bullets.",
      },
      {
        title: "Closing text",
        layout: "text",
        body: "Next steps and owners.",
      },
    ],
  });

  assert.equal(generated.success, true);
  assert.equal((generated.data as any).filename, "Board  Review.pptx");
  assert.equal((generated.data as any).slideCount, 6);

  const blob = harness.files.get((generated.data as any).storageId);
  assert.ok(blob);
  const zip = await unzipBlob(blob!);
  const chartXml = await zip.file("ppt/charts/chart1.xml")?.async("string");
  const notesXml = await zip.file("ppt/notesSlides/notesSlide3.xml")?.async("string");

  assert.match(chartXml ?? "", /ARR/);
  assert.match(notesXml ?? "", /board summary/i);

  const readBack = await readPptx.execute(harness.toolCtx, {
    storageId: (generated.data as any).storageId,
  });

  assert.equal(readBack.success, true);
  assert.equal((readBack.data as any).slideCount, 6);
  assert.match(String((readBack.data as any).text), /Board \/ Review/);
  assert.match(String((readBack.data as any).text), /KPI table/);
  assert.match(
    String((readBack.data as any).markdown),
    /\*\*Notes:\*\*\s*Use this slide for the board summary\./i,
  );
});

test("editPptx verifies the source deck and stores a regenerated presentation", async () => {
  const harness = createStorageHarness();
  const original = await generatePptx.execute(harness.toolCtx, {
    title: "Source deck",
    slides: [{
      title: "Original slide",
      layout: "text",
      body: "Initial content",
    }],
  });

  const edited = await editPptx.execute(harness.toolCtx, {
    storageId: (original.data as any).storageId,
    title: "Updated / Deck",
    subtitle: "Refresh",
    showSlideNumbers: true,
    slides: [
      {
        title: "Updated section",
        layout: "section",
        body: "Reframed storyline",
      },
      {
        title: "Updated chart",
        layout: "chart",
        chart: {
          type: "line",
          labels: ["Week 1", "Week 2"],
          datasets: [{ name: "Usage", values: [5, 9], color: "00AA88" }],
        },
        notes: "Mention the week-over-week improvement.",
      },
    ],
  });

  assert.equal(edited.success, true);
  assert.equal((edited.data as any).originalStorageId, (original.data as any).storageId);
  assert.ok((edited.data as any).originalSlideCount > 0);
  assert.ok((edited.data as any).originalWordCount > 0);
  assert.equal((edited.data as any).newSlideCount, 3);

  const readBack = await readPptx.execute(harness.toolCtx, {
    storageId: (edited.data as any).newStorageId,
  });

  assert.equal(readBack.success, true);
  assert.match(String((readBack.data as any).text), /Updated section/);
  assert.match(String((readBack.data as any).text), /Updated chart/);
  assert.doesNotMatch(String((readBack.data as any).text), /Initial content/);
});
