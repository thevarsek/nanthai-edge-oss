// convex/tools/edit_docx.ts
// =============================================================================
// Tool: edit_docx — reads an existing .docx from Convex storage, replaces its
// content with new structured sections, and stores the result as a new file.
//
// This is a "read → regenerate" approach: the JSZip-based extractor reads the
// old text (for context / word-count summary), then a fresh document is built
// with the docx package. True in-place OOXML editing is fragile and
// unnecessary for LLM workflows — the model already knows the new content.
//
// Supports the same extended params as generate_docx: fonts, sizes, margins,
// heading levels H1-H6, tables, headers/footers, TOC, inline bold/italic.
// =============================================================================

import { Id } from "../_generated/dataModel";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  Header,
  Footer,
  PageNumber,
  TableOfContents,
  convertInchesToTwip,
  ShadingType,
  TableLayoutType,
} from "docx";
import { extractDocxContent } from "./docx_reader";
import { createTool } from "./registry";
import { sanitizeFilename } from "./sanitize";

// ---------------------------------------------------------------------------
// Types (shared with generate_docx)
// ---------------------------------------------------------------------------

interface DocxTableInput {
  headers: string[];
  rows: string[][];
  columnWidths?: number[];
}

interface DocxSection {
  heading: string;
  headingLevel?: number;
  body: string;
  table?: DocxTableInput;
}

interface DocxMargins {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

const A4_WIDTH_TWIPS = 11906;

// ---------------------------------------------------------------------------
// Inline formatting parser (same as generate_docx)
// ---------------------------------------------------------------------------

function parseInlineFormatting(
  text: string,
  baseFont: string,
  baseSizeHp: number,
): TextRun[] {
  const runs: TextRun[] = [];
  const re = /(\*{3}(.*?)\*{3})|(\*{2}(.*?)\*{2})|(\*(.*?)\*)|([^*]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[2] !== undefined) {
      runs.push(new TextRun({ text: match[2], bold: true, italics: true, font: baseFont, size: baseSizeHp }));
    } else if (match[4] !== undefined) {
      runs.push(new TextRun({ text: match[4], bold: true, font: baseFont, size: baseSizeHp }));
    } else if (match[6] !== undefined) {
      runs.push(new TextRun({ text: match[6], italics: true, font: baseFont, size: baseSizeHp }));
    } else if (match[7] !== undefined) {
      runs.push(new TextRun({ text: match[7], font: baseFont, size: baseSizeHp }));
    }
  }
  if (runs.length === 0) {
    runs.push(new TextRun({ text, font: baseFont, size: baseSizeHp }));
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Table builder (same as generate_docx)
// ---------------------------------------------------------------------------

function normalizeTable(input: DocxTableInput): DocxTableInput | undefined {
  const headers = Array.isArray(input.headers) ? input.headers.map(String) : [];
  if (headers.length === 0) return undefined;
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const normalizedRows = rows.map((row) => {
    const raw = Array.isArray(row) ? row : [];
    return headers.map((_, index) => {
      const value = raw[index];
      return value == null ? "" : String(value);
    });
  });
  const columnWidths = input.columnWidths && input.columnWidths.length === headers.length
    ? input.columnWidths
    : undefined;
  return { headers, rows: normalizedRows, columnWidths };
}

function scaledColumnWidths(input: DocxTableInput, tableWidthTwips: number): number[] {
  const numCols = input.headers.length;
  const rawWidths = input.columnWidths && input.columnWidths.length === numCols
    ? input.columnWidths.map((w) => Math.max(1, convertInchesToTwip(w)))
    : Array.from({ length: numCols }, () => Math.floor(tableWidthTwips / numCols));
  const total = rawWidths.reduce((sum, width) => sum + width, 0);
  if (total <= tableWidthTwips) return rawWidths;
  return rawWidths.map((width) => Math.max(1, Math.floor((width / total) * tableWidthTwips)));
}

function buildTable(input: DocxTableInput, tableWidthTwips: number): Table {
  const numCols = input.headers.length;
  const colWidths = scaledColumnWidths(input, tableWidthTwips);

  const headerCells = input.headers.map((h, i) =>
    new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text: h, bold: true, font: "Calibri", size: 22, color: "FFFFFF" })],
        alignment: AlignmentType.LEFT,
      })],
      width: { size: colWidths[i], type: WidthType.DXA },
      shading: { type: ShadingType.SOLID, color: "2C3E50", fill: "2C3E50" },
    }),
  );

  const dataRows = input.rows.map((row) =>
    new TableRow({
      children: row.slice(0, numCols).map((cell, i) =>
        new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: cell ?? "", font: "Calibri", size: 22 })],
          })],
          width: { size: colWidths[i], type: WidthType.DXA },
        }),
      ),
    }),
  );

  return new Table({
    rows: [
      new TableRow({ children: headerCells, tableHeader: true }),
      ...dataRows,
    ],
    width: { size: tableWidthTwips, type: WidthType.DXA },
    columnWidths: colWidths,
    layout: TableLayoutType.FIXED,
  });
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const editDocx = createTool({
  name: "edit_docx",
  description:
    "Edit a Microsoft Word document (.docx). Reads the original document from storage, " +
    "then generates a new version with the provided sections. Use when the user wants " +
    "to modify, rewrite, or update an existing Word file. You must provide the full " +
    "updated content — this replaces the entire document. Supports the same formatting " +
    "options as generate_docx (fonts, margins, heading levels, tables, headers/footers, TOC).",
  parameters: {
    type: "object",
    properties: {
      storageId: {
        type: "string",
        description: "The Convex storage ID of the original .docx file to edit",
      },
      title: {
        type: "string",
        description: "New document title",
      },
      sections: {
        type: "array",
        description: "The full updated document sections (replaces all content)",
        items: {
          type: "object",
          properties: {
            heading: { type: "string", description: "Section heading" },
            headingLevel: {
              type: "number",
              description: "Heading level 1-6 (default 1).",
            },
            body: {
              type: "string",
              description: "Section body text. Newlines separate paragraphs. **bold** and *italic* supported.",
            },
            table: {
              type: "object",
              description: "Optional table after body text.",
              properties: {
                headers: { type: "array", items: { type: "string" } },
                rows: { type: "array", items: { type: "array", items: { type: "string" } } },
                columnWidths: { type: "array", items: { type: "number" } },
              },
              required: ["headers", "rows"],
            },
          },
          required: ["heading", "body"],
        },
      },
      fontFamily: { type: "string", description: "Body font (default 'Calibri')." },
      fontSize: { type: "number", description: "Body font size in pt (default 11)." },
      headingFont: { type: "string", description: "Heading font (default same as fontFamily)." },
      lineSpacing: { type: "number", description: "Line spacing multiplier (default 1.15)." },
      margins: {
        type: "object",
        description: "Page margins in inches (default 1\" all sides).",
        properties: {
          top: { type: "number" }, right: { type: "number" },
          bottom: { type: "number" }, left: { type: "number" },
        },
      },
      headerText: { type: "string", description: "Page header text." },
      showPageNumbers: { type: "boolean", description: "Show 'Page X of Y' footer (default false)." },
      includeToc: { type: "boolean", description: "Include Table of Contents (default false)." },
    },
    required: ["storageId", "title", "sections"],
  },

  execute: async (toolCtx, args) => {
    if (!args.storageId || typeof args.storageId !== "string") {
      return { success: false, data: null, error: "Missing or invalid 'storageId'" };
    }
    const storageId = args.storageId as string;
    const title = args.title as string;
    const sections = args.sections as DocxSection[];
    if (!title || typeof title !== "string") {
      return { success: false, data: null, error: "Missing or invalid 'title'" };
    }
    if (!Array.isArray(sections) || sections.length === 0) {
      return { success: false, data: null, error: "'sections' must be a non-empty array" };
    }

    // Step 1: Verify the original file exists and extract old text for summary.
    let originalBlob: Blob | null;
    try {
      originalBlob = await toolCtx.ctx.storage.get(storageId as Id<"_storage">);
    } catch {
      return { success: false, data: null, error: `Invalid storageId: "${storageId}"` };
    }
    if (!originalBlob) {
      return { success: false, data: null, error: `Original file not found: "${storageId}"` };
    }

    let originalWordCount = 0;
    try {
      const ab = await originalBlob.arrayBuffer();
      const extraction = await extractDocxContent(ab);
      originalWordCount = extraction.wordCount;
    } catch {
      // Non-fatal — we can still generate the new doc.
    }

    // Step 2: Build the new document (same logic as generate_docx).
    const fontFamily = (args.fontFamily as string) || "Calibri";
    const headingFont = (args.headingFont as string) || fontFamily;
    const bodyFontSizeHp = Math.round(((args.fontSize as number) || 11) * 2);
    const lineSpacingTwips = Math.round(((args.lineSpacing as number) || 1.15) * 240);
    const margins: DocxMargins = {
      top: (args.margins as DocxMargins)?.top ?? 1,
      right: (args.margins as DocxMargins)?.right ?? 1,
      bottom: (args.margins as DocxMargins)?.bottom ?? 1,
      left: (args.margins as DocxMargins)?.left ?? 1,
    };
    const headerText = (args.headerText as string) || "";
    const showPageNumbers = (args.showPageNumbers as boolean) ?? false;
    const includeToc = (args.includeToc as boolean) ?? false;
    const tableWidthTwips = Math.max(
      2880,
      A4_WIDTH_TWIPS - convertInchesToTwip(margins.left!) - convertInchesToTwip(margins.right!),
    );

    const HEADING_LEVELS = [
      HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
      HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
    ];
    const headingSizesHp = [
      Math.round(bodyFontSizeHp * 2.36), Math.round(bodyFontSizeHp * 1.82),
      Math.round(bodyFontSizeHp * 1.45), Math.round(bodyFontSizeHp * 1.27),
      Math.round(bodyFontSizeHp * 1.09), bodyFontSizeHp,
    ];

    const children: (Paragraph | Table | TableOfContents)[] = [
      new Paragraph({
        children: [new TextRun({ text: title, font: headingFont, size: Math.round(bodyFontSizeHp * 2.7), bold: true })],
        heading: HeadingLevel.TITLE,
        spacing: { after: 300 },
      }),
    ];

    if (includeToc) {
      children.push(new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-6" }));
      children.push(new Paragraph({ spacing: { after: 200 } }));
    }

    for (const section of sections) {
      const level = Math.max(1, Math.min(6, section.headingLevel ?? 1));
      children.push(
        new Paragraph({
          children: [new TextRun({ text: section.heading, font: headingFont, size: headingSizesHp[level - 1], bold: true })],
          heading: HEADING_LEVELS[level - 1],
          spacing: { before: 240, after: 120 },
        }),
      );

      const bodyLines = (section.body ?? "").split("\n").filter((l) => l.trim());
      for (const line of bodyLines) {
        children.push(
          new Paragraph({
            children: parseInlineFormatting(line, fontFamily, bodyFontSizeHp),
            spacing: { after: 120, line: lineSpacingTwips },
          }),
        );
      }

      if (section.table && Array.isArray(section.table.headers) && Array.isArray(section.table.rows)) {
        const table = normalizeTable(section.table);
        if (table) {
          children.push(buildTable(table, tableWidthTwips));
          children.push(new Paragraph({ spacing: { after: 120 } }));
        }
      }
    }

    const sectionHeaders: Record<string, Header> = {};
    const sectionFooters: Record<string, Footer> = {};
    if (headerText) {
      sectionHeaders.default = new Header({
        children: [new Paragraph({
          children: [new TextRun({ text: headerText, font: fontFamily, size: Math.round(bodyFontSizeHp * 0.82), italics: true, color: "888888" })],
          alignment: AlignmentType.RIGHT,
        })],
      });
    }
    if (showPageNumbers) {
      sectionFooters.default = new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], font: fontFamily, size: Math.round(bodyFontSizeHp * 0.82), color: "888888" })],
        })],
      });
    }

    const doc = new Document({
      features: includeToc ? { updateFields: true } : undefined,
      styles: {
        default: {
          document: {
            run: { font: fontFamily, size: bodyFontSizeHp },
            paragraph: { spacing: { line: lineSpacingTwips } },
          },
        },
      },
      sections: [{
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(margins.top!), right: convertInchesToTwip(margins.right!),
              bottom: convertInchesToTwip(margins.bottom!), left: convertInchesToTwip(margins.left!),
            },
          },
        },
        headers: Object.keys(sectionHeaders).length > 0 ? sectionHeaders : undefined,
        footers: Object.keys(sectionFooters).length > 0 ? sectionFooters : undefined,
        children,
      }],
    });

    const blob = await Packer.toBlob(doc);

    // Step 3: Store the new version.
    const newStorageId = await toolCtx.ctx.storage.store(blob);
    const safeTitle = sanitizeFilename(title, "document");
    const filename = `${safeTitle}.docx`;
    const mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    const siteUrl = process.env.CONVEX_SITE_URL;
    const downloadUrl = siteUrl
      ? `${siteUrl}/download?storageId=${encodeURIComponent(newStorageId)}&filename=${encodeURIComponent(filename)}`
      : await toolCtx.ctx.storage.getUrl(newStorageId);

    const newWordCount = sections.reduce((sum, s) => {
      return sum + s.body.split(/\s+/).filter(Boolean).length;
    }, 0);

    return {
      success: true,
      data: {
        originalStorageId: storageId,
        storageId: newStorageId,
        newStorageId,
        downloadUrl,
        filename,
        mimeType,
        sizeBytes: blob.size,
        title,
        summary: `Regenerated document with ${sections.length} section${sections.length === 1 ? "" : "s"}.`,
        originalWordCount,
        newWordCount,
        markdownLink: `[${filename}](${downloadUrl})`,
        message: `Document edited. The app will present a document card for ${filename}.`,
      },
    };
  },
});
