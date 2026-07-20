import assert from "node:assert/strict";
import test from "node:test";

import { editXlsx } from "../tools/edit_xlsx";
import { extractXlsx } from "../tools/xlsx_reader";
import { buildXlsxBlob } from "../tools/xlsx_writer";

async function originalWorkbook() {
  return await buildXlsxBlob({
    title: "Original",
    sheets: [{ name: "Original", headers: ["Name"], rows: [["Ada"]] }],
  });
}

test("editXlsx validates storage, title, original file, and sheet payloads", async () => {
  const missingStorage = await editXlsx.execute({} as any, {
    title: "Updated",
    sheets: [{ name: "Sheet", headers: [], rows: [] }],
  });
  assert.equal(missingStorage.success, false);
  assert.match(String(missingStorage.error), /storageId/);

  const missingTitle = await editXlsx.execute({} as any, {
    storageId: "storage_1",
    sheets: [{ name: "Sheet", headers: [], rows: [] }],
  });
  assert.equal(missingTitle.success, false);
  assert.match(String(missingTitle.error), /title/);

  const invalidStorage = await editXlsx.execute({
    ctx: { storage: { get: async () => { throw new Error("bad id"); } } },
  } as any, { storageId: "bad", title: "Updated", sheets: [{ name: "Sheet", headers: [], rows: [] }] });
  assert.equal(invalidStorage.success, false);
  assert.match(String(invalidStorage.error), /Invalid storageId/);

  const missingFile = await editXlsx.execute({
    ctx: { storage: { get: async () => null } },
  } as any, { storageId: "missing", title: "Updated", sheets: [{ name: "Sheet", headers: [], rows: [] }] });
  assert.equal(missingFile.success, false);
  assert.match(String(missingFile.error), /File not found/);

  const invalidWorkbook = await editXlsx.execute({
    ctx: { storage: { get: async () => new Blob(["not xlsx"]) } },
  } as any, { storageId: "text", title: "Updated", sheets: [{ name: "Sheet", headers: [], rows: [] }] });
  assert.equal(invalidWorkbook.success, false);
  assert.match(String(invalidWorkbook.error), /not a valid .xlsx/);

  const missingSheets = await editXlsx.execute({
    ctx: { storage: { get: async () => originalWorkbook() } },
  } as any, { storageId: "storage_1", title: "Updated", sheets: [] });
  assert.equal(missingSheets.success, false);
  assert.match(String(missingSheets.error), /At least one sheet/);
});

test("editXlsx rebuilds with sanitized sheets, preserved text, and site download URL", async () => {
  const originalSiteUrl = process.env.CONVEX_SITE_URL;
  const stored: Blob[] = [];
  process.env.CONVEX_SITE_URL = "https://nanthai.example";

  try {
    const result = await editXlsx.execute({
      ctx: {
        storage: {
          get: async () => originalWorkbook(),
          store: async (blob: Blob) => {
            stored.push(blob);
            return "new/storage id";
          },
          getUrl: async () => "https://fallback.example/file",
        },
      },
    } as any, {
      storageId: "storage_1",
      title: " Updated? / Forecast ",
      sheets: [{
        name: "Very/Long*Sheet?Name[With]InvalidCharacters",
        headers: ["Amount", "Flag", "Blank", "Formula"],
        rows: [[" 42.5 ", true, null, "=SUM(A2:A2)"]],
        columnWidths: [12, 8, 10, 14],
        cellStyles: [{ range: "A1:D1", bold: true }],
        columnFormats: [{ column: 0, format: "$#,##0.00" }],
        mergedCells: ["A3:D3"],
      }],
      namedRanges: [{ name: "Totals", range: "'Very_Long_Sheet_Name_With_Inval'!A1:A2" }],
    });

    assert.equal(result.success, true);
    assert.equal((result.data as any).filename, "Updated_Forecast.xlsx");
    assert.equal(
      (result.data as any).downloadUrl,
      "https://nanthai.example/download?storageId=new%2Fstorage%20id&filename=Updated_Forecast.xlsx",
    );
    assert.match(String((result.data as any).sheets), /Very_Long_Sheet_Name_With_Inval/);
    assert.equal((result.data as any).totalRows, 1);
    assert.equal(stored.length, 1);

    const parsed = await extractXlsx(await stored[0]!.arrayBuffer());
    assert.equal(parsed.sheets[0].name.length, 31);
    assert.deepEqual(parsed.sheets[0].rows[0], [" 42.5 ", true, null, "=SUM(A2:A2)"]);
  } finally {
    if (originalSiteUrl === undefined) {
      delete process.env.CONVEX_SITE_URL;
    } else {
      process.env.CONVEX_SITE_URL = originalSiteUrl;
    }
  }
});
