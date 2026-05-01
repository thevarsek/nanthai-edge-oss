import assert from "node:assert/strict";
import test from "node:test";

import JSZip from "jszip";

import { generateDocx } from "../tools/generate_docx";

type ToolData = {
  storageId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  title: string;
  documentPurpose?: string;
  summary: string;
  warnings: string[];
};

async function runGenerateDocx(args: Record<string, unknown>) {
  const stored: Blob[] = [];
  const toolCtx = {
    userId: "user_1",
    ctx: {
      storage: {
        store: async (blob: Blob) => {
          stored.push(blob);
          return `storage_${stored.length}`;
        },
        getUrl: async (storageId: string) => `https://files.example/${storageId}`,
      },
    },
  } as any;

  const result = await generateDocx.execute(toolCtx, args);
  const data = result.data as ToolData | null;
  return { result, data, stored };
}

async function docxXml(blob: Blob, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  const file = zip.file(path);
  assert.ok(file, `Expected ${path} in generated docx`);
  return file.async("string");
}

test("generate_docx rejects skipped heading hierarchy levels", async () => {
  const { result } = await runGenerateDocx({
    title: "Hierarchy Test",
    sections: [
      { heading: "Deep section", headingLevel: 3, body: "This skips levels 1 and 2." },
    ],
  });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /Invalid heading hierarchy/);
});

test("generate_docx includes defined terms, appendices, page breaks, signatures, and landscape orientation", async () => {
  const { result, data, stored } = await runGenerateDocx({
    title: "Test Agreement",
    documentPurpose: "agreement",
    landscape: true,
    showPageNumbers: true,
    headerText: "Test Agreement",
    definedTerms: [
      { term: "Agreement", definition: "This Test Agreement." },
      { term: "Effective Date", definition: "The date signed by both parties." },
    ],
    sections: [
      { heading: "Preamble", unnumbered: true, body: "This agreement is made between the parties." },
      { heading: "Obligations", headingLevel: 1, body: "Each party shall perform its obligations." },
      { heading: "Payment", headingLevel: 2, body: "Fees are due within thirty days." },
    ],
    appendices: [
      { heading: "Appendix A", body: "Additional operating terms." },
    ],
    signatureBlocks: [
      { partyName: "NanthAI Ltd", title: "Director" },
      { partyName: "Customer Inc", title: "Authorised Signatory" },
    ],
  });

  assert.equal(result.success, true);
  assert.equal(data?.filename, "Test_Agreement.docx");
  assert.equal(data?.documentPurpose, "agreement");
  assert.equal(data?.mimeType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(data?.storageId, "storage_1");
  assert.ok((data?.sizeBytes ?? 0) > 0);
  assert.deepEqual(data?.warnings, []);
  assert.equal(stored.length, 1);

  const xml = await docxXml(stored[0]!, "word/document.xml");
  assert.match(xml, /Defined Terms/);
  assert.match(xml, /Agreement/);
  assert.match(xml, /Appendix A/);
  assert.match(xml, /Signatures/);
  assert.match(xml, /NanthAI Ltd/);
  assert.match(xml, /Customer Inc/);
  assert.match(xml, /w:type="page"/);
  assert.match(xml, /w:orient="landscape"/);
});

test("generate_docx normalizes malformed table rows and keeps fixed table widths", async () => {
  const { result, data, stored } = await runGenerateDocx({
    title: "Broken Columns / Agreement?",
    sections: [
      {
        heading: "Checklist",
        body: "Review the rows below.",
        table: {
          headers: ["Item", "Owner", "Status"],
          rows: [
            ["Long item text that used to collapse columns", "Legal"],
            ["Closing deliverables", "Finance", "Open", "Unexpected extra cell"],
          ],
          columnWidths: [8, 1, 1],
        },
      },
    ],
  });

  assert.equal(result.success, true);
  assert.equal(data?.filename, "Broken_Columns_Agreement.docx");
  assert.deepEqual(data?.warnings, [
    "Table row 1 has 2 cells; expected 3.",
    "Table row 2 has 4 cells; expected 3.",
  ]);

  const xml = await docxXml(stored[0]!, "word/document.xml");
  assert.match(xml, /w:tblLayout w:type="fixed"/);
  assert.match(xml, /Long item text that used to collapse columns/);
  assert.match(xml, /Closing deliverables/);
  assert.doesNotMatch(xml, /Unexpected extra cell/);
});
