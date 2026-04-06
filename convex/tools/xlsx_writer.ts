// convex/tools/xlsx_writer.ts
// =============================================================================
// Low-level OOXML SpreadsheetML (.xlsx) builder using JSZip.
//
// Generates valid .xlsx files without exceljs or any Node.js dependencies,
// so it works in Convex's default V8 runtime.
//
// Supports:
// - Multiple worksheets
// - Shared string table (for text cells)
// - Number cells (integers and decimals)
// - Boolean cells
// - Formula cells
// - Header styling (bold, background color)
// - Column auto-width estimation + explicit widths
// - Frozen header row
// - Cell-level styling (bold, font color, background color, borders)
// - Number formats (currency, percentage, date, custom)
// - Merged cells
// - Named ranges
// =============================================================================

import JSZip from "jszip";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Cell-level style override. Applied to a rectangular range. */
export interface XlsxCellStyle {
  /** Range in A1 notation, e.g. "A1:C1" or "B2:B10" or "D5" for a single cell. */
  range: string;
  bold?: boolean;
  /** Font color as hex RGB without #, e.g. "FF0000" for red. */
  fontColor?: string;
  /** Background fill color as hex RGB without #, e.g. "FFFF00" for yellow. */
  bgColor?: string;
  /** Border style: "thin", "medium", "thick". Default none. */
  borderStyle?: string;
  /** Number format string, e.g. "$#,##0.00", "0.0%", "yyyy-mm-dd". */
  numberFormat?: string;
}

/** Column-level number format. */
export interface XlsxColumnFormat {
  /** Column index (0-based). */
  column: number;
  /** Excel number format string. Common: "$#,##0.00", "0.0%", "yyyy-mm-dd", "#,##0". */
  format: string;
}

export interface XlsxSheet {
  name: string;
  headers: string[];
  rows: (string | number | boolean | null)[][];
  /** Optional: freeze the header row (default true). */
  freezeHeader?: boolean;
  /** Optional: explicit column widths (length must match headers). */
  columnWidths?: number[];
  /** Optional: cell style overrides. */
  cellStyles?: XlsxCellStyle[];
  /** Optional: column number formats. */
  columnFormats?: XlsxColumnFormat[];
  /** Optional: merged cell ranges in A1 notation, e.g. ["A1:C1", "D5:D10"]. */
  mergedCells?: string[];
}

export interface XlsxOptions {
  title: string;
  sheets: XlsxSheet[];
  /** Optional: named ranges, e.g. [{name: "Revenue", range: "Sheet1!A2:A100"}]. */
  namedRanges?: Array<{ name: string; range: string }>;
}

// ---------------------------------------------------------------------------
// XML escaping
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// Cell reference helpers (A1, B1, ..., Z1, AA1, AB1, ...)
// ---------------------------------------------------------------------------

function colLetter(index: number): string {
  let result = "";
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

function cellRef(col: number, row: number): string {
  return `${colLetter(col)}${row}`;
}

// ---------------------------------------------------------------------------
// Parse A1-style range into col/row indices
// ---------------------------------------------------------------------------

function parseA1(ref: string): { col: number; row: number } {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) return { col: 0, row: 1 };
  let col = 0;
  for (let i = 0; i < match[1].length; i++) {
    col = col * 26 + (match[1].charCodeAt(i) - 64);
  }
  return { col: col - 1, row: parseInt(match[2], 10) };
}

function parseRange(range: string): { startCol: number; startRow: number; endCol: number; endRow: number } {
  const parts = range.split(":");
  const start = parseA1(parts[0]);
  const end = parts.length > 1 ? parseA1(parts[1]) : start;
  return { startCol: start.col, startRow: start.row, endCol: end.col, endRow: end.row };
}

// ---------------------------------------------------------------------------
// Shared string table builder
// ---------------------------------------------------------------------------

class SharedStrings {
  private map = new Map<string, number>();
  private list: string[] = [];

  index(value: string): number {
    const existing = this.map.get(value);
    if (existing !== undefined) return existing;
    const idx = this.list.length;
    this.map.set(value, idx);
    this.list.push(value);
    return idx;
  }

  toXml(): string {
    const items = this.list
      .map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`)
      .join("");
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      `count="${this.list.length}" uniqueCount="${this.list.length}">` +
      items +
      `</sst>`
    );
  }

  get count(): number {
    return this.list.length;
  }
}

// ---------------------------------------------------------------------------
// Style registry — deduplicates font+fill+border+numFmt combos into <xf> entries
// ---------------------------------------------------------------------------

interface StyleKey {
  bold: boolean;
  fontColor: string; // "000000" for default
  bgColor: string;   // "" for no fill
  borderStyle: string; // "" | "thin" | "medium" | "thick"
  numFmtId: number;
}

class StyleRegistry {
  // Custom number format IDs start at 164 (per OOXML spec)
  private nextNumFmtId = 164;
  private numFmtMap = new Map<string, number>(); // format string → numFmtId
  private numFmtList: Array<{ id: number; formatCode: string }> = [];

  // Fonts: 0=default, 1=bold header, 2+ = custom
  private fontKeys: string[] = [];
  private fontXml: string[] = [];

  // Fills: 0=none, 1=gray125 (required by spec), 2=header blue-grey, 3+ = custom
  private fillKeys: string[] = [];
  private fillXml: string[] = [];

  // Borders: 0=none, 1=thin all, 2+ = custom
  private borderKeys: string[] = [];
  private borderXml: string[] = [];

  // Cell XFs: 0=default, 1=header, 2+ = custom
  private xfKeys: string[] = [];
  private xfList: Array<{ fontId: number; fillId: number; borderId: number; numFmtId: number }> = [];

  constructor() {
    // Pre-register built-in styles that must exist

    // Fonts: 0=default, 1=bold
    this.fontKeys.push("normal|000000");
    this.fontXml.push(`<font><sz val="11"/><name val="Calibri"/></font>`);
    this.fontKeys.push("bold|000000");
    this.fontXml.push(`<font><b/><sz val="11"/><name val="Calibri"/></font>`);

    // Fills: 0=none, 1=gray125, 2=header blue-grey
    this.fillKeys.push("none");
    this.fillXml.push(`<fill><patternFill patternType="none"/></fill>`);
    this.fillKeys.push("gray125");
    this.fillXml.push(`<fill><patternFill patternType="gray125"/></fill>`);
    this.fillKeys.push("D9E2F3");
    this.fillXml.push(`<fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/></patternFill></fill>`);

    // Borders: 0=none, 1=thin all
    this.borderKeys.push("none");
    this.borderXml.push(`<border/>`);
    this.borderKeys.push("thin");
    this.borderXml.push(
      `<border>` +
      `<left style="thin"><color auto="1"/></left>` +
      `<right style="thin"><color auto="1"/></right>` +
      `<top style="thin"><color auto="1"/></top>` +
      `<bottom style="thin"><color auto="1"/></bottom>` +
      `</border>`,
    );

    // XFs: 0=default, 1=header (bold + fill + border)
    this.xfKeys.push("0|0|0|0");
    this.xfList.push({ fontId: 0, fillId: 0, borderId: 0, numFmtId: 0 });
    this.xfKeys.push("1|2|1|0");
    this.xfList.push({ fontId: 1, fillId: 2, borderId: 1, numFmtId: 0 });
  }

  /** Register or find a number format, returning its numFmtId. */
  getNumFmtId(format: string): number {
    // Built-in formats we can reuse without custom registration
    const builtIn: Record<string, number> = {
      "General": 0,
      "0": 1,
      "0.00": 2,
      "#,##0": 3,
      "#,##0.00": 4,
      "0%": 9,
      "0.00%": 10,
      "mm-dd-yy": 14,
      "d-mmm-yy": 15,
      "d-mmm": 16,
      "mmm-yy": 17,
      "h:mm AM/PM": 18,
      "h:mm:ss AM/PM": 19,
      "h:mm": 20,
      "h:mm:ss": 21,
      "m/d/yy h:mm": 22,
    };
    if (builtIn[format] !== undefined) return builtIn[format];

    const existing = this.numFmtMap.get(format);
    if (existing !== undefined) return existing;

    const id = this.nextNumFmtId++;
    this.numFmtMap.set(format, id);
    this.numFmtList.push({ id, formatCode: format });
    return id;
  }

  /** Get or create a font entry, returning its fontId. */
  private getFontId(bold: boolean, fontColor: string): number {
    const key = `${bold ? "bold" : "normal"}|${fontColor}`;
    const idx = this.fontKeys.indexOf(key);
    if (idx >= 0) return idx;

    const colorAttr = fontColor !== "000000" ? `<color rgb="FF${fontColor}"/>` : "";
    const boldTag = bold ? "<b/>" : "";
    this.fontKeys.push(key);
    this.fontXml.push(`<font>${boldTag}<sz val="11"/>${colorAttr}<name val="Calibri"/></font>`);
    return this.fontKeys.length - 1;
  }

  /** Get or create a fill entry, returning its fillId. */
  private getFillId(bgColor: string): number {
    if (!bgColor) return 0; // no fill
    const idx = this.fillKeys.indexOf(bgColor);
    if (idx >= 0) return idx;

    this.fillKeys.push(bgColor);
    this.fillXml.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${bgColor}"/></patternFill></fill>`);
    return this.fillKeys.length - 1;
  }

  /** Get or create a border entry, returning its borderId. */
  private getBorderId(style: string): number {
    if (!style) return 0;
    const idx = this.borderKeys.indexOf(style);
    if (idx >= 0) return idx;

    this.borderKeys.push(style);
    this.borderXml.push(
      `<border>` +
      `<left style="${style}"><color auto="1"/></left>` +
      `<right style="${style}"><color auto="1"/></right>` +
      `<top style="${style}"><color auto="1"/></top>` +
      `<bottom style="${style}"><color auto="1"/></bottom>` +
      `</border>`,
    );
    return this.borderKeys.length - 1;
  }

  /** Get the xf index (style ID) for a given combination. Creates if needed. */
  getStyleId(style: StyleKey): number {
    const fontId = this.getFontId(style.bold, style.fontColor);
    const fillId = this.getFillId(style.bgColor);
    const borderId = this.getBorderId(style.borderStyle);
    const key = `${fontId}|${fillId}|${borderId}|${style.numFmtId}`;

    const idx = this.xfKeys.indexOf(key);
    if (idx >= 0) return idx;

    this.xfKeys.push(key);
    this.xfList.push({ fontId, fillId, borderId, numFmtId: style.numFmtId });
    return this.xfKeys.length - 1;
  }

  /** Build the complete styles.xml content. */
  toXml(): string {
    const numFmtsXml = this.numFmtList.length > 0
      ? `<numFmts count="${this.numFmtList.length}">` +
        this.numFmtList.map((nf) => `<numFmt numFmtId="${nf.id}" formatCode="${escapeXml(nf.formatCode)}"/>`).join("") +
        `</numFmts>`
      : "";

    const fontsXml = `<fonts count="${this.fontXml.length}">${this.fontXml.join("")}</fonts>`;
    const fillsXml = `<fills count="${this.fillXml.length}">${this.fillXml.join("")}</fills>`;
    const bordersXml = `<borders count="${this.borderXml.length}">${this.borderXml.join("")}</borders>`;

    const cellStyleXfs = `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`;

    const xfs = this.xfList.map((xf) => {
      const applyAttrs: string[] = [];
      if (xf.fontId > 0) applyAttrs.push(`applyFont="1"`);
      if (xf.fillId > 0) applyAttrs.push(`applyFill="1"`);
      if (xf.borderId > 0) applyAttrs.push(`applyBorder="1"`);
      if (xf.numFmtId > 0) applyAttrs.push(`applyNumberFormat="1"`);
      return `<xf numFmtId="${xf.numFmtId}" fontId="${xf.fontId}" fillId="${xf.fillId}" borderId="${xf.borderId}" xfId="0"${applyAttrs.length > 0 ? " " + applyAttrs.join(" ") : ""}/>`;
    }).join("");

    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      numFmtsXml +
      fontsXml +
      fillsXml +
      bordersXml +
      cellStyleXfs +
      `<cellXfs count="${this.xfList.length}">${xfs}</cellXfs>` +
      `</styleSheet>`
    );
  }
}

// ---------------------------------------------------------------------------
// Build per-cell style map from sheet.cellStyles + sheet.columnFormats
// ---------------------------------------------------------------------------

function buildCellStyleMap(
  sheet: XlsxSheet,
  styleRegistry: StyleRegistry,
): Map<string, number> {
  // Map of "COL,ROW" → style index
  const map = new Map<string, number>();
  const totalRows = sheet.rows.length + 1; // +1 for header row

  // First apply columnFormats (lower priority)
  if (sheet.columnFormats) {
    for (const cf of sheet.columnFormats) {
      const numFmtId = styleRegistry.getNumFmtId(cf.format);
      const styleId = styleRegistry.getStyleId({
        bold: false, fontColor: "000000", bgColor: "", borderStyle: "", numFmtId,
      });
      // Apply to all data rows (row 2+) in this column
      for (let r = 2; r <= totalRows; r++) {
        map.set(`${cf.column},${r}`, styleId);
      }
    }
  }

  // Then apply cellStyles (higher priority — overwrites columnFormats)
  if (sheet.cellStyles) {
    for (const cs of sheet.cellStyles) {
      const { startCol, startRow, endCol, endRow } = parseRange(cs.range);
      const numFmtId = cs.numberFormat
        ? styleRegistry.getNumFmtId(cs.numberFormat)
        : 0;
      const styleId = styleRegistry.getStyleId({
        bold: cs.bold ?? false,
        fontColor: cs.fontColor?.replace("#", "") || "000000",
        bgColor: cs.bgColor?.replace("#", "") || "",
        borderStyle: cs.borderStyle || "",
        numFmtId,
      });
      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          map.set(`${c},${r}`, styleId);
        }
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Worksheet XML builder
// ---------------------------------------------------------------------------

function buildSheetXml(
  sheet: XlsxSheet,
  sharedStrings: SharedStrings,
  styleRegistry: StyleRegistry,
): string {
  const freeze = sheet.freezeHeader !== false;
  const numCols = sheet.headers.length;

  // Column widths — explicit or auto-estimated
  const colWidths: number[] = sheet.columnWidths && sheet.columnWidths.length === numCols
    ? sheet.columnWidths
    : sheet.headers.map((h) => Math.min(50, Math.max(8, h.length + 2)));

  if (!sheet.columnWidths) {
    // Auto-widen based on data
    for (const row of sheet.rows) {
      for (let c = 0; c < numCols; c++) {
        const val = row[c];
        if (val != null) {
          const len = String(val).length + 2;
          colWidths[c] = Math.min(50, Math.max(colWidths[c], len));
        }
      }
    }
  }

  const colDefs = colWidths
    .map(
      (w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" bestFit="1" customWidth="1"/>`,
    )
    .join("");

  // Build per-cell style map
  const cellStyleMap = buildCellStyleMap(sheet, styleRegistry);

  // Build rows
  const xmlRows: string[] = [];

  // Header row (row 1) — style index 1 (bold + fill)
  const headerCells = sheet.headers
    .map((h, c) => {
      const si = sharedStrings.index(h);
      return `<c r="${cellRef(c, 1)}" t="s" s="1"><v>${si}</v></c>`;
    })
    .join("");
  xmlRows.push(`<row r="1">${headerCells}</row>`);

  // Data rows (starting at row 2)
  for (let r = 0; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    const rowNum = r + 2;
    const cells: string[] = [];

    for (let c = 0; c < numCols; c++) {
      const val = row[c];
      if (val == null) continue;

      const ref = cellRef(c, rowNum);
      const styleId = cellStyleMap.get(`${c},${rowNum}`) ?? 0;
      const sAttr = styleId > 0 ? ` s="${styleId}"` : "";

      if (typeof val === "number") {
        cells.push(`<c r="${ref}"${sAttr}><v>${val}</v></c>`);
      } else if (typeof val === "boolean") {
        cells.push(`<c r="${ref}" t="b"${sAttr}><v>${val ? 1 : 0}</v></c>`);
      } else {
        const str = String(val);
        if (str.startsWith("=")) {
          cells.push(`<c r="${ref}"${sAttr}><f>${escapeXml(str.slice(1))}</f></c>`);
        } else {
          const si = sharedStrings.index(str);
          cells.push(`<c r="${ref}" t="s"${sAttr}><v>${si}</v></c>`);
        }
      }
    }

    xmlRows.push(`<row r="${rowNum}">${cells.join("")}</row>`);
  }

  // Sheet views (freeze pane on row 1 if enabled)
  const sheetView = freeze
    ? `<sheetViews><sheetView tabSelected="1" workbookViewId="0">` +
      `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
      `</sheetView></sheetViews>`
    : `<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>`;

  const dimension =
    numCols > 0
      ? `A1:${cellRef(numCols - 1, sheet.rows.length + 1)}`
      : "A1";

  // Merged cells
  let mergeCellsXml = "";
  if (sheet.mergedCells && sheet.mergedCells.length > 0) {
    const refs = sheet.mergedCells
      .map((r) => `<mergeCell ref="${escapeXml(r)}"/>`)
      .join("");
    mergeCellsXml = `<mergeCells count="${sheet.mergedCells.length}">${refs}</mergeCells>`;
  }

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="${dimension}"/>` +
    sheetView +
    `<cols>${colDefs}</cols>` +
    `<sheetData>${xmlRows.join("")}</sheetData>` +
    mergeCellsXml +
    `</worksheet>`
  );
}

// ---------------------------------------------------------------------------
// Workbook & package assembly
// ---------------------------------------------------------------------------

export async function buildXlsxBlob(options: XlsxOptions): Promise<Blob> {
  const zip = new JSZip();
  const sharedStrings = new SharedStrings();
  const styleRegistry = new StyleRegistry();
  const sheets = options.sheets;

  // Build each sheet's XML (populates sharedStrings and styleRegistry as side-effects)
  const sheetXmls = sheets.map((s) => buildSheetXml(s, sharedStrings, styleRegistry));

  // [Content_Types].xml
  const sheetContentTypes = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
        `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ` +
      `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      sheetContentTypes +
      `<Override PartName="/xl/styles.xml" ` +
      `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `<Override PartName="/xl/sharedStrings.xml" ` +
      `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
      `</Types>`,
  );

  // _rels/.rels
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  );

  // xl/workbook.xml — with optional named ranges
  const sheetEntries = sheets
    .map(
      (s, i) =>
        `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join("");

  let definedNamesXml = "";
  if (options.namedRanges && options.namedRanges.length > 0) {
    const names = options.namedRanges
      .map((nr) => `<definedName name="${escapeXml(nr.name)}">${escapeXml(nr.range)}</definedName>`)
      .join("");
    definedNamesXml = `<definedNames>${names}</definedNames>`;
  }

  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>${sheetEntries}</sheets>` +
      definedNamesXml +
      `</workbook>`,
  );

  // xl/_rels/workbook.xml.rels
  const sheetRels = sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" ` +
        `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ` +
        `Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("");

  const stylesRelId = sheets.length + 1;
  const sharedStringsRelId = sheets.length + 2;

  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheetRels +
      `<Relationship Id="rId${stylesRelId}" ` +
      `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ` +
      `Target="styles.xml"/>` +
      `<Relationship Id="rId${sharedStringsRelId}" ` +
      `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" ` +
      `Target="sharedStrings.xml"/>` +
      `</Relationships>`,
  );

  // xl/styles.xml — built from the style registry after all sheets processed
  zip.file("xl/styles.xml", styleRegistry.toXml());

  // xl/sharedStrings.xml (built after sheet XML so all strings are collected)
  zip.file("xl/sharedStrings.xml", sharedStrings.toXml());

  // xl/worksheets/sheet{n}.xml
  for (let i = 0; i < sheetXmls.length; i++) {
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXmls[i]);
  }

  // Generate the ZIP as an ArrayBuffer, then wrap in Blob
  const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
  return new Blob([arrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
