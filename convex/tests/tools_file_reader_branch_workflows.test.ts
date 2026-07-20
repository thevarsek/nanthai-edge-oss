import assert from "node:assert/strict";
import test from "node:test";

import { generatePdf } from "../tools/generate_pdf";
import { generateTextFile } from "../tools/generate_text_file";
import { readDocx } from "../tools/read_docx";
import { readPptx } from "../tools/read_pptx";
import { readXlsx } from "../tools/read_xlsx";

test("generateTextFile validates inputs, sanitizes blank names, and falls back to storage URLs", async () => {
  const missingName = await generateTextFile.execute({} as any, {
    format: "txt",
    content: "hello",
  });
  const badFormat = await generateTextFile.execute({} as any, {
    filename: "notes",
    format: "pdf",
    content: "hello",
  });
  const missingContent = await generateTextFile.execute({} as any, {
    filename: "notes",
    format: "txt",
  });

  assert.equal(missingName.error, "Missing or invalid 'filename'");
  assert.match(String(badFormat.error), /Invalid format/);
  assert.equal(missingContent.error, "Missing or invalid 'content'");

  const originalSiteUrl = process.env.CONVEX_SITE_URL;
  delete process.env.CONVEX_SITE_URL;
  const stored: Blob[] = [];
  try {
    const result = await generateTextFile.execute({
      userId: "user_1",
      ctx: {
        storage: {
          store: async (blob: Blob) => {
            stored.push(blob);
            return "storage_1";
          },
          getUrl: async (id: string) => `https://storage.example/${id}`,
        },
      },
    } as any, {
      filename: " ?! ",
      format: "csv",
      content: "name,value\nAlice,1",
    });

    assert.equal(result.success, true);
    assert.equal(stored[0]?.type, "text/csv");
    assert.equal((result.data as any).filename, "file.csv");
    assert.equal((result.data as any).downloadUrl, "https://storage.example/storage_1");
  } finally {
    if (originalSiteUrl !== undefined) {
      process.env.CONVEX_SITE_URL = originalSiteUrl;
    }
  }
});

test("generatePdf validates title and reports runtime generation errors", async () => {
  const missingTitle = await generatePdf.execute({} as any, {
    title: "   ",
    sections: [{ body: "Summary" }],
  });
  assert.equal(missingTitle.success, false);
  assert.equal(missingTitle.error, "Missing title.");

  const runtimeError = await generatePdf.execute({ userId: "user_1" } as any, {
    title: "Quarterly report",
    filename: 123,
    author: 456,
    sections: [{ heading: "Overview", body: "Summary" }],
  });
  assert.equal(runtimeError.success, false);
  assert.match(String(runtimeError.error), /require chatId/i);
});

test("Office readers validate missing, invalid, absent, and corrupt storage inputs", async () => {
  const readers = [
    { name: "docx", tool: readDocx, parseError: /Failed to parse \.docx file/ },
    { name: "xlsx", tool: readXlsx, parseError: /Failed to parse \.xlsx file/ },
    { name: "pptx", tool: readPptx, parseError: /Failed to parse \.pptx file/ },
  ];

  for (const { name, tool, parseError } of readers) {
    const missingArg = await tool.execute({} as any, {});
    assert.equal(missingArg.success, false, name);
    assert.equal(missingArg.error, "Missing or invalid 'storageId'");

    const invalidId = await tool.execute({
      userId: "user_1",
      ctx: {
        ...(name === "pptx" || name === "xlsx"
          ? { runQuery: async () => { throw new Error("bad id"); } }
          : {}),
        storage: {
          get: async () => {
            throw new Error("bad id");
          },
        },
      },
    } as any, { storageId: `${name}_bad` });
    assert.equal(invalidId.success, false, name);
    assert.match(String(invalidId.error), /Invalid storageId/);

    const missingFile = await tool.execute({
      userId: "user_1",
      ctx: {
        ...(name === "pptx" || name === "xlsx"
          ? { runQuery: async () => ({ storageId: `${name}_missing` }) }
          : {}),
        storage: { get: async () => null },
      },
    } as any, { storageId: `${name}_missing` });
    assert.equal(missingFile.success, false, name);
    assert.match(String(missingFile.error), /File not found/);

    const corrupt = await tool.execute({
      userId: "user_1",
      ctx: {
        ...(name === "pptx" || name === "xlsx"
          ? { runQuery: async () => ({ storageId: `${name}_corrupt` }) }
          : {}),
        storage: {
          get: async () => new Blob(["not an office archive"], { type: "text/plain" }),
        },
      },
    } as any, { storageId: `${name}_corrupt` });
    assert.equal(corrupt.success, false, name);
    assert.match(String(corrupt.error), parseError);
  }
});
