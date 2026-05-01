// convex/tools/generate_docx.ts
// =============================================================================
// Tool: generate_docx — creates a Word document and stores it in Convex
// file storage. Returns a download URL the model can present to the user.
//
// Uses `Packer.toBlob()` (not `toBuffer()`) so it works in the Convex
// default runtime without "use node".
//
// Extended capabilities:
// - Heading levels H1–H6
// - Custom fonts, font sizes, line spacing
// - Page margins
// - Tables with optional column widths
// - Headers and footers with page numbers
// - Table of contents
// - Bold / italic via **bold** and *italic* markers in body text
// =============================================================================

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
  PageBreak,
  PageOrientation,
  TableLayoutType,
} from "docx";
import { createTool } from "./registry";
import { sanitizeFilename } from "./sanitize";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocxTableInput {
  headers: string[];
  rows: string[][];
  /** Optional column widths in inches (e.g. [2, 3, 1.5]). Auto if omitted. */
  columnWidths?: number[];
}

interface DocxSection {
  heading?: string;
  /** Heading level 1–6. Default 1. */
  headingLevel?: number;
  /** Alias used by some recipe prompts. */
  level?: number;
  /** Body text. Newlines separate paragraphs. **bold** and *italic* markers supported. */
  body?: string;
  /** Alias used by Mike-style workflow prompts. */
  content?: string;
  /** Render without numbered/heading styling. Useful for contract preambles and signature blocks. */
  unnumbered?: boolean;
  /** Start this section on a new page. */
  pageBreak?: boolean;
  pageBreakBefore?: boolean;
  /** Optional table to render after body text. */
  table?: DocxTableInput;
}

interface DocxMargins {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

interface SignatureBlockInput {
  partyName: string;
  title?: string;
}

interface NormalizedTableResult {
  table?: DocxTableInput;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS = {
  fontFamily: "Calibri",
  fontSize: 22, // half-points → 11pt
  headingFont: "Calibri",
  headingFontSizes: [52, 40, 32, 28, 24, 22] as number[], // H1–H6 in half-points (26, 20, 16, 14, 12, 11 pt)
  lineSpacing: 276, // 1.15× in twips
  margins: { top: 1, right: 1, bottom: 1, left: 1 }, // inches
  headerText: "",
  showPageNumbers: false,
  includeToc: false,
};

const A4_WIDTH_TWIPS = 11906;
const A4_HEIGHT_TWIPS = 16838;

// ---------------------------------------------------------------------------
// Inline formatting parser: **bold**, *italic*, ***bold+italic***
// ---------------------------------------------------------------------------

function parseInlineFormatting(
  text: string,
  baseFont: string,
  baseSizeHp: number,
): TextRun[] {
  const runs: TextRun[] = [];
  // Regex: ***both***, **bold**, *italic*, or plain text
  const re = /(\*{3}(.*?)\*{3})|(\*{2}(.*?)\*{2})|(\*(.*?)\*)|([^*]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[2] !== undefined) {
      // ***bold+italic***
      runs.push(new TextRun({ text: match[2], bold: true, italics: true, font: baseFont, size: baseSizeHp }));
    } else if (match[4] !== undefined) {
      // **bold**
      runs.push(new TextRun({ text: match[4], bold: true, font: baseFont, size: baseSizeHp }));
    } else if (match[6] !== undefined) {
      // *italic*
      runs.push(new TextRun({ text: match[6], italics: true, font: baseFont, size: baseSizeHp }));
    } else if (match[7] !== undefined) {
      // plain text
      runs.push(new TextRun({ text: match[7], font: baseFont, size: baseSizeHp }));
    }
  }
  if (runs.length === 0) {
    runs.push(new TextRun({ text, font: baseFont, size: baseSizeHp }));
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Table builder
// ---------------------------------------------------------------------------

function normalizeTable(input: DocxTableInput): NormalizedTableResult {
  const warnings: string[] = [];
  const headers = Array.isArray(input.headers) ? input.headers.map(String) : [];
  if (headers.length === 0) {
    return {
      table: undefined,
      warnings: ["Table skipped because it has no headers."],
    };
  }
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const normalizedRows = rows.map((row, rowIndex) => {
    const raw = Array.isArray(row) ? row : [];
    if (raw.length !== headers.length) {
      warnings.push(`Table row ${rowIndex + 1} has ${raw.length} cells; expected ${headers.length}.`);
    }
    return headers.map((_, colIndex) => {
      const value = raw[colIndex];
      return value == null ? "" : String(value);
    });
  });
  const columnWidths = input.columnWidths && input.columnWidths.length === headers.length
    ? input.columnWidths
    : undefined;
  if (input.columnWidths && input.columnWidths.length !== headers.length) {
    warnings.push("Column widths ignored because they do not match header count.");
  }
  return {
    table: { headers, rows: normalizedRows, columnWidths },
    warnings,
  };
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

function appendNormalizedTable(
  children: (Paragraph | Table | TableOfContents)[],
  input: DocxTableInput,
  tableWidthTwips: number,
  warnings: string[],
): void {
  const normalized = normalizeTable(input);
  warnings.push(...normalized.warnings);
  if (!normalized.table) return;
  children.push(buildTable(normalized.table, tableWidthTwips));
  children.push(new Paragraph({ spacing: { after: 120 } }));
}

function sectionLevel(section: DocxSection): number {
  return Math.max(1, Math.min(6, section.headingLevel ?? section.level ?? 1));
}

function sectionBody(section: DocxSection): string {
  return section.body ?? section.content ?? "";
}

function validateHeadingHierarchy(sections: DocxSection[]): string | undefined {
  let deepestSeen = 0;
  for (const section of sections) {
    if (section.unnumbered || !section.heading) continue;
    const level = sectionLevel(section);
    if (level > deepestSeen + 1) {
      return `Invalid heading hierarchy: "${section.heading}" is level ${level}, but level ${deepestSeen + 1} is required first.`;
    }
    deepestSeen = Math.max(deepestSeen, level);
  }
  return undefined;
}

function textParagraph(text: string, fontFamily: string, bodyFontSizeHp: number, lineSpacingTwips: number): Paragraph {
  return new Paragraph({
    children: parseInlineFormatting(text, fontFamily, bodyFontSizeHp),
    spacing: { after: 120, line: lineSpacingTwips },
  });
}

function buildDefinedTermsTable(terms: unknown): DocxTableInput | undefined {
  if (!Array.isArray(terms) || terms.length === 0) return undefined;
  const rows = terms.map((entry) => {
    const item = entry as Record<string, unknown>;
    return [
      String(item.term ?? ""),
      String(item.definition ?? ""),
    ];
  });
  return {
    headers: ["Term", "Definition"],
    rows,
    columnWidths: [2.2, 4.3],
  };
}

function buildSignatureSections(input: unknown): DocxSection[] {
  if (!Array.isArray(input) || input.length === 0) return [];
  return [{
    heading: "Signatures",
    unnumbered: true,
    pageBreak: true,
    body: input.map((raw) => {
      const block = raw as SignatureBlockInput;
      const partyName = block.partyName || "Party";
      return [
        partyName,
        "",
        "By: ______________________________",
        "Name: ____________________________",
        `Title: ${block.title ?? "____________________________"}`,
        "Date: ____________________________",
      ].join("\n");
    }).join("\n\n"),
  }];
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const generateDocx = createTool({
  name: "generate_docx",
  description:
    "Generate a Microsoft Word document (.docx) with structured sections. " +
    "Use for reports, letters, proposals, documentation, or any content the " +
    "user wants as a downloadable Word file. Supports heading levels H1-H6, " +
    "unnumbered preambles, page breaks, appendices/exhibits, signature blocks, " +
    "defined-term tables, custom fonts and sizes, tables, page margins, " +
    "headers/footers with page numbers, table of contents, landscape layout, " +
    "and bold/italic formatting via **bold** and *italic* markers in body text. " +
    "All formatting params are optional with sensible defaults.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Document title displayed at the top of the document",
      },
      documentPurpose: {
        type: "string",
        enum: ["memo", "letter", "agreement", "report", "brief", "proposal", "checklist"],
        description: "Optional purpose hint used for naming and structure.",
      },
      sections: {
        type: "array",
        description: "Ordered list of document sections with headings and body text",
        items: {
          type: "object",
          properties: {
            heading: {
              type: "string",
              description: "Section heading. Omit for unnumbered preamble paragraphs.",
            },
            headingLevel: {
              type: "number",
              description:
                "Heading level 1-6 (default 1). Use 1 for major sections, " +
                "2 for subsections, 3+ for deeper nesting.",
            },
            level: {
              type: "number",
              description: "Alias for headingLevel. Useful for template-style prompts.",
            },
            body: {
              type: "string",
              description:
                "Section body text. Use newlines to separate paragraphs. " +
                "Use **text** for bold, *text* for italic, ***text*** for both.",
            },
            content: {
              type: "string",
              description: "Alias for body. Use body unless following a provided template.",
            },
            unnumbered: {
              type: "boolean",
              description: "Render this section as plain unnumbered content. Use for preambles, recitals, and signature blocks.",
            },
            pageBreak: {
              type: "boolean",
              description: "Start this section on a new page.",
            },
            pageBreakBefore: {
              type: "boolean",
              description: "Alias for pageBreak.",
            },
            table: {
              type: "object",
              description: "Optional table to include after the body text.",
              properties: {
                headers: {
                  type: "array",
                  description: "Column header labels",
                  items: { type: "string" },
                },
                rows: {
                  type: "array",
                  description: "Data rows — each row is an array of cell strings",
                  items: { type: "array", items: { type: "string" } },
                },
                columnWidths: {
                  type: "array",
                  description:
                    "Optional column widths in inches (e.g. [2, 3, 1.5]). " +
                    "Must match headers length. Auto-sized if omitted.",
                  items: { type: "number" },
                },
              },
              required: ["headers", "rows"],
            },
          },
          required: [],
        },
      },
      appendices: {
        type: "array",
        description: "Optional appendix or exhibit sections appended after the main sections.",
        items: {
          type: "object",
          properties: {
            heading: { type: "string" },
            body: { type: "string" },
            content: { type: "string" },
            table: {
              type: "object",
              properties: {
                headers: { type: "array", items: { type: "string" } },
                rows: { type: "array", items: { type: "array", items: { type: "string" } } },
                columnWidths: { type: "array", items: { type: "number" } },
              },
              required: ["headers", "rows"],
            },
          },
        },
      },
      definedTerms: {
        type: "array",
        description: "Optional defined-term table, rendered with Term and Definition columns near the front.",
        items: {
          type: "object",
          properties: {
            term: { type: "string" },
            definition: { type: "string" },
          },
          required: ["term", "definition"],
        },
      },
      signatureBlocks: {
        type: "array",
        description: "Optional signature blocks. For agreements, put these at the end on a fresh page.",
        items: {
          type: "object",
          properties: {
            partyName: { type: "string" },
            title: { type: "string" },
          },
          required: ["partyName"],
        },
      },
      // ---- Optional formatting params (all have sensible defaults) ----
      fontFamily: {
        type: "string",
        description:
          "Body font family (default 'Calibri'). Common: Arial, Times New Roman, Georgia.",
      },
      fontSize: {
        type: "number",
        description:
          "Body font size in points (default 11). Headings scale proportionally.",
      },
      headingFont: {
        type: "string",
        description:
          "Font for headings (default same as fontFamily). Use for contrast, e.g. 'Georgia' headings with 'Arial' body.",
      },
      lineSpacing: {
        type: "number",
        description:
          "Line spacing multiplier (default 1.15). Use 1.0 for single, 1.5 for one-and-half, 2.0 for double.",
      },
      margins: {
        type: "object",
        description:
          "Page margins in inches (default 1\" all sides).",
        properties: {
          top: { type: "number" },
          right: { type: "number" },
          bottom: { type: "number" },
          left: { type: "number" },
        },
      },
      headerText: {
        type: "string",
        description:
          "Text to display in the page header (top of every page). Leave empty for no header.",
      },
      showPageNumbers: {
        type: "boolean",
        description:
          "Show page numbers in the footer (default false). Displays 'Page X of Y' centered.",
      },
      includeToc: {
        type: "boolean",
        description:
          "Include a Table of Contents after the title (default false). " +
          "Best for documents with 4+ sections.",
      },
      landscape: {
        type: "boolean",
        description: "Use landscape page orientation. Useful for wide checklists and tables.",
      },
    },
    required: ["title", "sections"],
  },

  execute: async (toolCtx, args) => {
    const title = args.title as string;
    const sections = args.sections as DocxSection[];
    const documentPurpose = typeof args.documentPurpose === "string" ? args.documentPurpose : undefined;

    if (!title || typeof title !== "string") {
      return { success: false, data: null, error: "Missing or invalid 'title'" };
    }
    if (!Array.isArray(sections) || sections.length === 0) {
      return {
        success: false,
        data: null,
        error: "'sections' must be a non-empty array",
      };
    }
    const hierarchyError = validateHeadingHierarchy(sections);
    if (hierarchyError) {
      return { success: false, data: null, error: hierarchyError };
    }

    // Resolve optional params with defaults
    const fontFamily = (args.fontFamily as string) || DEFAULTS.fontFamily;
    const headingFont = (args.headingFont as string) || fontFamily;
    const bodyFontSizeHp = Math.round(((args.fontSize as number) || 11) * 2); // pt → half-points
    const lineSpacingTwips = Math.round(((args.lineSpacing as number) || 1.15) * 240);
    const margins: DocxMargins = {
      top: (args.margins as DocxMargins)?.top ?? DEFAULTS.margins.top,
      right: (args.margins as DocxMargins)?.right ?? DEFAULTS.margins.right,
      bottom: (args.margins as DocxMargins)?.bottom ?? DEFAULTS.margins.bottom,
      left: (args.margins as DocxMargins)?.left ?? DEFAULTS.margins.left,
    };
    const headerText = (args.headerText as string) || "";
    const showPageNumbers = (args.showPageNumbers as boolean) ?? false;
    const includeToc = (args.includeToc as boolean) ?? false;
    const landscape = (args.landscape as boolean) ?? false;
    const warnings: string[] = [];
    const pageWidthTwips = landscape ? A4_HEIGHT_TWIPS : A4_WIDTH_TWIPS;
    const tableWidthTwips = Math.max(
      2880,
      pageWidthTwips - convertInchesToTwip(margins.left!) - convertInchesToTwip(margins.right!),
    );

    // Heading level → HeadingLevel enum
    const HEADING_LEVELS = [
      HeadingLevel.HEADING_1,
      HeadingLevel.HEADING_2,
      HeadingLevel.HEADING_3,
      HeadingLevel.HEADING_4,
      HeadingLevel.HEADING_5,
      HeadingLevel.HEADING_6,
    ];

    // Heading font sizes (scale from body size)
    const headingSizesHp = [
      Math.round(bodyFontSizeHp * 2.36), // H1 ≈ 26pt for 11pt body
      Math.round(bodyFontSizeHp * 1.82), // H2 ≈ 20pt
      Math.round(bodyFontSizeHp * 1.45), // H3 ≈ 16pt
      Math.round(bodyFontSizeHp * 1.27), // H4 ≈ 14pt
      Math.round(bodyFontSizeHp * 1.09), // H5 ≈ 12pt
      bodyFontSizeHp,                     // H6 = body size
    ];

    // Build document children
    const children: (Paragraph | Table | TableOfContents)[] = [
      new Paragraph({
        children: [new TextRun({ text: title, font: headingFont, size: Math.round(bodyFontSizeHp * 2.7), bold: true })],
        heading: HeadingLevel.TITLE,
        spacing: { after: 300 },
      }),
    ];

    // Table of contents (if requested)
    if (includeToc) {
      children.push(
        new TableOfContents("Table of Contents", {
          hyperlink: true,
          headingStyleRange: "1-6",
        }),
      );
      children.push(new Paragraph({ spacing: { after: 200 } })); // spacer
    }

    const definedTermsTable = buildDefinedTermsTable(args.definedTerms);
    if (definedTermsTable) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "Defined Terms", font: headingFont, size: headingSizesHp[0], bold: true })],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        }),
      );
      appendNormalizedTable(children, definedTermsTable, tableWidthTwips, warnings);
    }

    const appendices = Array.isArray(args.appendices)
      ? (args.appendices as DocxSection[]).map((appendix, index) => ({
        ...appendix,
        heading: appendix.heading ?? `Appendix ${index + 1}`,
        headingLevel: appendix.headingLevel ?? 1,
        pageBreak: appendix.pageBreak ?? index === 0,
      }))
      : [];
    const allSections = [
      ...sections,
      ...appendices,
      ...buildSignatureSections(args.signatureBlocks),
    ];

    for (const section of allSections) {
      if (section.pageBreak || section.pageBreakBefore) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }

      const body = sectionBody(section);
      if (section.unnumbered) {
        if (section.heading) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: section.heading, font: headingFont, size: headingSizesHp[1], bold: true })],
              spacing: { before: 240, after: 120 },
            }),
          );
        }
        const bodyLines = body.split("\n").filter((l) => l.trim());
        for (const line of bodyLines) {
          children.push(textParagraph(line, fontFamily, bodyFontSizeHp, lineSpacingTwips));
        }
        if (section.table && Array.isArray(section.table.headers) && Array.isArray(section.table.rows)) {
          appendNormalizedTable(children, section.table, tableWidthTwips, warnings);
        }
        continue;
      }

      const level = sectionLevel(section);
      const headingEnum = HEADING_LEVELS[level - 1];
      const headingSizeHp = headingSizesHp[level - 1];

      // Section heading
      if (section.heading) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: section.heading, font: headingFont, size: headingSizeHp, bold: true })],
            heading: headingEnum,
            spacing: { before: 240, after: 120 },
          }),
        );
      }

      // Body paragraphs with inline formatting
      const bodyLines = body.split("\n").filter((l) => l.trim());
      for (const line of bodyLines) {
        children.push(textParagraph(line, fontFamily, bodyFontSizeHp, lineSpacingTwips));
      }

      // Optional table
      if (section.table && Array.isArray(section.table.headers) && Array.isArray(section.table.rows)) {
        appendNormalizedTable(children, section.table, tableWidthTwips, warnings);
      }
    }

    // Build headers/footers
    const sectionHeaders: Record<string, Header> = {};
    const sectionFooters: Record<string, Footer> = {};

    if (headerText) {
      sectionHeaders.default = new Header({
        children: [
          new Paragraph({
            children: [new TextRun({ text: headerText, font: fontFamily, size: Math.round(bodyFontSizeHp * 0.82), italics: true, color: "888888" })],
            alignment: AlignmentType.RIGHT,
          }),
        ],
      });
    }

    if (showPageNumbers) {
      sectionFooters.default = new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], font: fontFamily, size: Math.round(bodyFontSizeHp * 0.82), color: "888888" }),
            ],
          }),
        ],
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
            size: landscape ? { orientation: PageOrientation.LANDSCAPE } : undefined,
            margin: {
              top: convertInchesToTwip(margins.top!),
              right: convertInchesToTwip(margins.right!),
              bottom: convertInchesToTwip(margins.bottom!),
              left: convertInchesToTwip(margins.left!),
            },
          },
        },
        headers: Object.keys(sectionHeaders).length > 0 ? sectionHeaders : undefined,
        footers: Object.keys(sectionFooters).length > 0 ? sectionFooters : undefined,
        children,
      }],
    });

    // Pack to Blob (works in Convex default V8 runtime — no Node required).
    const blob = await Packer.toBlob(doc);

    // Store in Convex file storage.
    const storageId = await toolCtx.ctx.storage.store(blob);

    // Sanitize filename: replace non-alphanumeric chars with underscores.
    const safeTitle = sanitizeFilename(title, "document");
    const filename = `${safeTitle}.docx`;
    const mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    // Build a download URL through our HTTP endpoint so the file downloads
    // with the correct filename (Convex storage URLs use opaque IDs).
    const siteUrl = process.env.CONVEX_SITE_URL;
    const downloadUrl = siteUrl
      ? `${siteUrl}/download?storageId=${encodeURIComponent(storageId)}&filename=${encodeURIComponent(filename)}`
      : await toolCtx.ctx.storage.getUrl(storageId);

    return {
      success: true,
      data: {
        storageId,
        downloadUrl,
        filename,
        mimeType,
        sizeBytes: blob.size,
        title,
        documentPurpose,
        summary: `Generated ${documentPurpose ?? "document"} with ${allSections.length} section${allSections.length === 1 ? "" : "s"}.`,
        warnings,
        markdownLink: `[${filename}](${downloadUrl})`,
        message: `Document generated. The app will present a document card for ${filename}.`,
      },
    };
  },
});
