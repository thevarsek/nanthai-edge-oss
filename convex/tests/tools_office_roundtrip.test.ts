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
    toolCtx: {
      userId: "user_1",
      ctx: {
        storage,
        runQuery: async () => ({
          storageId: "owned",
          filename: "deck.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          source: "generated",
        }),
      },
    } as any,
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
  assert.equal((generated.data as any).filename, "Ops_Scorecard.xlsx");

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
  assert.equal((generated.data as any).filename, "Quarterly_Review.docx");
  assert.ok((generated.data as any).sizeBytes > 0);

  const blob = harness.files.get((generated.data as any).storageId);
  assert.ok(blob);
  const zip = await unzipBlob(blob!);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  const footerXml = await zip.file("word/footer1.xml")?.async("string");

  assert.match(documentXml ?? "", /Table of Contents/);
  assert.match(documentXml ?? "", /Overview/);
  assert.match(documentXml ?? "", /Metrics/);
  assert.match(documentXml ?? "", /<w:tblLayout w:type="fixed"\/>/);
  assert.match(documentXml ?? "", /<w:tblW w:type="dxa"/);
  assert.match(footerXml ?? "", /PAGE/);

  const readBack = await readDocx.execute(harness.toolCtx, {
    storageId: (generated.data as any).storageId,
  });

  assert.equal(readBack.success, true);
  assert.match(String((readBack.data as any).text), /overview/i);
  assert.match(String((readBack.data as any).text), /Revenue/);
  assert.ok((readBack.data as any).wordCount > 0);
});

test("generateDocx supports M33 legal document structure", async () => {
  const harness = createStorageHarness();
  const generated = await generateDocx.execute(harness.toolCtx, {
    title: "Execution / Checklist: CP?",
    documentPurpose: "agreement",
    landscape: true,
    definedTerms: [
      { term: "Agreement", definition: "This document and its appendices." },
    ],
    sections: [
      {
        content: "This preamble is intentionally unnumbered.",
        unnumbered: true,
      },
      {
        heading: "Overview",
        level: 1,
        body: "Primary terms.",
        table: {
          headers: ["Item", "Status"],
          rows: [["KYC"], ["Board approval", "Pending", "Extra cell"]],
        },
      },
      {
        heading: "Closing Deliverables",
        headingLevel: 2,
        pageBreakBefore: true,
        body: "Deliverables start on a new page.",
      },
    ],
    appendices: [
      {
        heading: "Appendix A - Forms",
        body: "Form documents.",
      },
    ],
    signatureBlocks: [
      { partyName: "Borrower", title: "Director" },
      { partyName: "Lender" },
    ],
  });

  assert.equal(generated.success, true);
  assert.equal((generated.data as any).filename, "Execution_Checklist_CP.docx");
  assert.equal((generated.data as any).mimeType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal((generated.data as any).documentPurpose, "agreement");
  assert.ok(((generated.data as any).warnings as string[]).length >= 2);

  const blob = harness.files.get((generated.data as any).storageId);
  assert.ok(blob);
  const zip = await unzipBlob(blob!);
  const documentXml = await zip.file("word/document.xml")?.async("string");

  assert.match(documentXml ?? "", /Defined Terms/);
  assert.match(documentXml ?? "", /Closing Deliverables/);
  assert.match(documentXml ?? "", /Appendix A - Forms/);
  assert.match(documentXml ?? "", /Signatures/);
  assert.match(documentXml ?? "", /w:br w:type="page"/);
  assert.match(documentXml ?? "", /w:orient="landscape"/);
  assert.doesNotMatch(documentXml ?? "", /<w:tblGrid\/>/);
});

test("generateDocx skips empty tables instead of writing invalid OOXML", async () => {
  const harness = createStorageHarness();
  const generated = await generateDocx.execute(harness.toolCtx, {
    title: "Empty table guard",
    sections: [
      {
        heading: "Overview",
        body: "This table should be skipped.",
        table: {
          headers: [],
          rows: [],
        },
      },
    ],
  });

  assert.equal(generated.success, true);
  assert.deepEqual((generated.data as any).warnings, ["Table skipped because it has no headers."]);

  const blob = harness.files.get((generated.data as any).storageId);
  assert.ok(blob);
  const zip = await unzipBlob(blob!);
  const documentXml = await zip.file("word/document.xml")?.async("string");

  assert.doesNotMatch(documentXml ?? "", /<w:tbl>/);
});

test("generateDocx rejects skipped heading levels", async () => {
  const harness = createStorageHarness();
  const generated = await generateDocx.execute(harness.toolCtx, {
    title: "Bad hierarchy",
    sections: [
      {
        heading: "Skipped",
        headingLevel: 3,
        body: "This skips H1 and H2.",
      },
    ],
  });

  assert.equal(generated.success, false);
  assert.match(String(generated.error), /Invalid heading hierarchy/);
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

test("editDocx covers validation, extraction failures, advanced options, and site download URLs", async () => {
  const harness = createStorageHarness();
  const originalSiteUrl = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = "https://convex.example";

  const missingStorageId = await editDocx.execute(harness.toolCtx, {
    storageId: "",
    title: "Doc",
    sections: [{ heading: "One", body: "Body" }],
  });
  const missingTitle = await editDocx.execute(harness.toolCtx, {
    storageId: "missing",
    title: "",
    sections: [{ heading: "One", body: "Body" }],
  });
  const missingSections = await editDocx.execute(harness.toolCtx, {
    storageId: "missing",
    title: "Doc",
    sections: [],
  });
  const missingOriginal = await editDocx.execute(harness.toolCtx, {
    storageId: "missing",
    title: "Doc",
    sections: [{ heading: "One", body: "Body" }],
  });
  const throwingCtx = {
    userId: "user_1",
    ctx: {
      storage: {
        get: async () => {
          throw new Error("bad id");
        },
      },
    },
  } as any;
  const invalidStorage = await editDocx.execute(throwingCtx, {
    storageId: "bad",
    title: "Doc",
    sections: [{ heading: "One", body: "Body" }],
  });

  assert.equal(missingStorageId.success, false);
  assert.equal(missingTitle.success, false);
  assert.equal(missingSections.success, false);
  assert.equal(missingOriginal.success, false);
  assert.equal(invalidStorage.success, false);

  const corruptStorageId = await harness.storage.store(new Blob(["not a docx"], { type: "text/plain" }));
  try {
    const edited = await editDocx.execute(harness.toolCtx, {
      storageId: corruptStorageId,
      title: "Advanced / Edit",
      fontFamily: "Aptos",
      fontSize: 12,
      headingFont: "Aptos Display",
      lineSpacing: 1.4,
      margins: { top: 0.25, right: 0.25, bottom: 0.25, left: 0.25 },
      headerText: "Confidential",
      showPageNumbers: true,
      includeToc: true,
      sections: [
        {
          heading: "Too high",
          headingLevel: 99,
          body: "***both*** **bold** *italic*\nPlain text",
          table: {
            headers: ["A", "B"],
            rows: [["one"], ["two", null as any, "extra"]],
            columnWidths: [100, 100],
          },
        },
        {
          heading: "Too low",
          headingLevel: -5,
          body: "",
          table: { headers: [], rows: [] },
        },
        {
          heading: "No table",
          body: "Final words",
          table: { headers: "bad" as any, rows: [] },
        },
      ],
    });

    assert.equal(edited.success, true);
    assert.equal((edited.data as any).originalWordCount, 0);
    assert.equal((edited.data as any).newWordCount, 7);
    assert.match(String((edited.data as any).downloadUrl), /^https:\/\/convex\.example\/download/);
    assert.match(String((edited.data as any).summary), /3 sections/);
  } finally {
    if (originalSiteUrl === undefined) {
      delete process.env.CONVEX_SITE_URL;
    } else {
      process.env.CONVEX_SITE_URL = originalSiteUrl;
    }
  }
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
  assert.equal((generated.data as any).filename, "Board_Review.pptx");
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

test("editPptx validates required arguments and missing source storage", async () => {
  const harness = createStorageHarness();

  const missingStorageId = await editPptx.execute(harness.toolCtx, {
    storageId: "",
    title: "Deck",
    slides: [{ title: "Slide" }],
  });
  const missingTitle = await editPptx.execute(harness.toolCtx, {
    storageId: "storage_missing",
    title: "",
    slides: [{ title: "Slide" }],
  });
  const missingSlides = await editPptx.execute(harness.toolCtx, {
    storageId: "storage_missing",
    title: "Deck",
    slides: [],
  });
  const missingSource = await editPptx.execute(harness.toolCtx, {
    storageId: "storage_missing",
    title: "Deck",
    slides: [{ title: "Slide" }],
  });

  assert.equal(missingStorageId.success, false);
  assert.match(String(missingStorageId.error), /storageId/);
  assert.equal(missingTitle.success, false);
  assert.match(String(missingTitle.error), /title/);
  assert.equal(missingSlides.success, false);
  assert.match(String(missingSlides.error), /non-empty array/);
  assert.equal(missingSource.success, false);
  assert.match(String(missingSource.error), /Original file not found/);
});

test("editPptx covers fallback layouts, image branches, warnings, and site download URLs", async () => {
  const harness = createStorageHarness();
  const originalSiteUrl = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = "https://convex.example";

  const original = await generatePptx.execute(harness.toolCtx, {
    title: "Original",
    slides: [{ title: "Source", body: "Base" }],
  });
  const pixelPng = "image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  try {
    const edited = await editPptx.execute(harness.toolCtx, {
      storageId: (original.data as any).storageId,
      title: "Branch Deck",
      theme: {
        primaryColor: "#101010",
        secondaryColor: "#202020",
        accentColor: "#303030",
        titleFont: "Aptos Display",
        bodyFont: "Aptos",
        titleFontSize: 22,
        bodyFontSize: 14,
        backgroundColor: "#FAFAFA",
      },
      showSlideNumbers: true,
      slides: [
        {
          title: "Fallback table",
          layout: "table",
          body: "- fallback body",
          table: { headers: "not-an-array", rows: [] },
        },
        {
          title: "Fallback chart",
          layout: "chart",
          body: "chart fallback",
          chart: { type: "pie", labels: ["A"], datasets: "bad" },
        },
        {
          title: "Image grid empty",
          layout: "image",
          body: "No images should still render",
        },
        {
          title: "Image grid populated",
          layout: "image",
          body: "Visible caption",
          backgroundImage: { data: pixelPng, altText: "Background" },
          images: [
            { data: pixelPng, altText: "One" },
            { data: pixelPng, altText: "Two" },
            { data: pixelPng, altText: "Three" },
            { data: pixelPng, altText: "Four" },
            { data: pixelPng, altText: "Five" },
            { data: pixelPng, altText: "Six" },
            { data: pixelPng, altText: "Seven" },
            { imageStorageId: "missing_image", altText: "Missing" },
          ],
        },
        {
          title: "Unknown layout",
          layout: "unexpected",
          body: "Default text branch",
        },
      ],
    });

    assert.equal(edited.success, true);
    assert.match(String((edited.data as any).downloadUrl), /^https:\/\/convex\.example\/download/);
    assert.match(String((edited.data as any).message), /Warnings:/);
    assert.equal((edited.data as any).imageCount, 8);
    assert.equal((edited.data as any).newSlideCount, 6);
  } finally {
    if (originalSiteUrl === undefined) {
      delete process.env.CONVEX_SITE_URL;
    } else {
      process.env.CONVEX_SITE_URL = originalSiteUrl;
    }
  }
});
