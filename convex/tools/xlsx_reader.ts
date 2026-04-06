// convex/tools/xlsx_reader.ts
// =============================================================================
// Lightweight .xlsx text extractor using JSZip.
//
// An .xlsx file is a ZIP archive containing OOXML SpreadsheetML XML files.
// We parse the shared string table, sheet data, and workbook metadata to
// extract cell values per sheet.
//
// Works in Convex's sandboxed V8 runtime (no Node.js dependencies).
// =============================================================================

import JSZip from "jszip";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface XlsxCellData {
  /** Column letter(s), e.g. "A", "B", "AA" */
  col: string;
  /** 1-based row number */
  row: number;
  /** Resolved cell value (string, number, or boolean) */
  value: string | number | boolean;
}

export interface XlsxSheetData {
  name: string;
  headers: string[];
  rows: (string | number | boolean | null)[][];
  totalRows: number;
  totalCols: number;
}

export interface XlsxExtraction {
  sheets: XlsxSheetData[];
  markdown: string;
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

/**
 * Extract all elements matching `<tag ...>...</tag>` OR self-closing `<tag .../>`.
 * Returns the full element string (including the tag itself) for each match.
 */
function getTagContent(xml: string, tag: string): string[] {
  const results: string[] = [];
  const openTag = `<${tag}`;
  let pos = 0;
  while (pos < xml.length) {
    const start = xml.indexOf(openTag, pos);
    if (start === -1) break;

    // Make sure we matched the full tag name (not a prefix like <sheets> when looking for <sheet>)
    const charAfterTag = xml[start + openTag.length];
    if (charAfterTag && charAfterTag !== " " && charAfterTag !== ">" && charAfterTag !== "/" && charAfterTag !== "\t" && charAfterTag !== "\n" && charAfterTag !== "\r") {
      pos = start + 1;
      continue;
    }

    // Check for self-closing tag: <tag ... />
    const selfCloseEnd = xml.indexOf("/>", start);
    const closeTag = `</${tag}>`;
    const fullCloseStart = xml.indexOf(closeTag, start);

    if (selfCloseEnd !== -1 && (fullCloseStart === -1 || selfCloseEnd < fullCloseStart)) {
      // Self-closing tag comes first — check it's within this element
      const gt = xml.indexOf(">", start);
      if (gt !== -1 && gt === selfCloseEnd + 1) {
        // The ">" we found is part of "/>"
        results.push(xml.substring(start, selfCloseEnd + 2));
        pos = selfCloseEnd + 2;
        continue;
      }
      // The "/>" is inside this tag's attributes area
      results.push(xml.substring(start, selfCloseEnd + 2));
      pos = selfCloseEnd + 2;
      continue;
    }

    if (fullCloseStart !== -1) {
      // Regular open/close tag
      const end = fullCloseStart + closeTag.length;
      results.push(xml.substring(start, end));
      pos = end;
    } else {
      // No closing found — skip
      pos = start + 1;
    }
  }
  return results;
}

function getAttr(element: string, attr: string): string | null {
  // Match attr="value" or attr='value'
  const regex = new RegExp(`${attr}=["']([^"']*)["']`);
  const match = element.match(regex);
  return match ? match[1] : null;
}

function innerText(xml: string, tag: string): string {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const start = xml.indexOf(open);
  if (start === -1) return "";
  // Find the end of the opening tag
  const tagEnd = xml.indexOf(">", start);
  if (tagEnd === -1) return "";
  const contentStart = tagEnd + 1;
  const end = xml.indexOf(close, contentStart);
  if (end === -1) return "";
  // Strip any nested tags
  return xml.substring(contentStart, end).replace(/<[^>]+>/g, "");
}

function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ---------------------------------------------------------------------------
// Cell reference parsing
// ---------------------------------------------------------------------------

function parseCellRef(ref: string): { col: string; row: number } | null {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  return { col: match[1], row: parseInt(match[2], 10) };
}

function colIndex(colLetters: string): number {
  let idx = 0;
  for (let i = 0; i < colLetters.length; i++) {
    idx = idx * 26 + (colLetters.charCodeAt(i) - 64);
  }
  return idx - 1; // 0-based
}

// ---------------------------------------------------------------------------
// Shared string table parser
// ---------------------------------------------------------------------------

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siBlocks = getTagContent(xml, "si");
  for (const si of siBlocks) {
    // Each <si> can contain <t>text</t> or multiple <r><t>text</t></r> runs
    const tBlocks = getTagContent(si, "t");
    let text = "";
    for (const t of tBlocks) {
      const content = t.replace(/<\/?t[^>]*>/g, "").trim();
      text += unescapeXml(content);
    }
    strings.push(text);
  }
  return strings;
}

// ---------------------------------------------------------------------------
// Workbook parser (sheet names + ordering)
// ---------------------------------------------------------------------------

interface WorkbookSheet {
  name: string;
  sheetId: string;
  rId: string;
}

function parseWorkbook(xml: string): WorkbookSheet[] {
  const sheets: WorkbookSheet[] = [];
  const sheetElements = getTagContent(xml, "sheet");
  for (const el of sheetElements) {
    const name = getAttr(el, "name");
    const sheetId = getAttr(el, "sheetId");
    const rId = getAttr(el, "r:id");
    if (name && sheetId && rId) {
      sheets.push({ name: unescapeXml(name), sheetId, rId });
    }
  }
  return sheets;
}

// ---------------------------------------------------------------------------
// Relationship parser
// ---------------------------------------------------------------------------

function parseRels(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const rels = getTagContent(xml, "Relationship");
  for (const rel of rels) {
    const id = getAttr(rel, "Id");
    const target = getAttr(rel, "Target");
    if (id && target) {
      map.set(id, target);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Sheet data parser
// ---------------------------------------------------------------------------

function parseSheetData(
  xml: string,
  sharedStrings: string[],
): { cells: Map<string, string | number | boolean>; maxCol: number; maxRow: number } {
  const cells = new Map<string, string | number | boolean>();
  let maxCol = 0;
  let maxRow = 0;

  const rowBlocks = getTagContent(xml, "row");
  for (const rowXml of rowBlocks) {
    const cellBlocks = getTagContent(rowXml, "c");
    for (const cellXml of cellBlocks) {
      const ref = getAttr(cellXml, "r");
      if (!ref) continue;

      const parsed = parseCellRef(ref);
      if (!parsed) continue;

      const ci = colIndex(parsed.col);
      if (ci > maxCol) maxCol = ci;
      if (parsed.row > maxRow) maxRow = parsed.row;

      const type = getAttr(cellXml, "t"); // s=shared string, b=boolean, n=number, inlineStr, etc.
      const vText = innerText(cellXml, "v");

      let value: string | number | boolean;

      if (type === "s") {
        // Shared string reference
        const idx = parseInt(vText, 10);
        value = sharedStrings[idx] ?? "";
      } else if (type === "b") {
        value = vText === "1";
      } else if (type === "inlineStr") {
        // Inline string: <is><t>text</t></is>
        value = unescapeXml(innerText(cellXml, "t"));
      } else {
        // Number or formula result
        if (vText === "") {
          // Check for formula text
          const fText = innerText(cellXml, "f");
          value = fText ? `=${fText}` : "";
        } else {
          const num = Number(vText);
          value = isNaN(num) ? unescapeXml(vText) : num;
        }
      }

      cells.set(ref, value);
    }
  }

  return { cells, maxCol, maxRow };
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

export async function extractXlsx(data: ArrayBuffer): Promise<XlsxExtraction> {
  const zip = await JSZip.loadAsync(data);

  // Parse shared strings
  const sharedStringsXml = await zip.file("xl/sharedStrings.xml")?.async("string");
  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];

  // Parse workbook (sheet names and order)
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  if (!workbookXml) {
    return { sheets: [], markdown: "(Empty or invalid .xlsx file)" };
  }
  const wbSheets = parseWorkbook(workbookXml);

  // Parse workbook relationships (rId → file path)
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  const rels = relsXml ? parseRels(relsXml) : new Map<string, string>();

  const sheets: XlsxSheetData[] = [];

  for (const wbSheet of wbSheets) {
    const target = rels.get(wbSheet.rId);
    if (!target) continue;

    // Target is relative to xl/, e.g. "worksheets/sheet1.xml"
    const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const sheetXml = await zip.file(sheetPath)?.async("string");
    if (!sheetXml) continue;

    const { cells, maxCol, maxRow } = parseSheetData(sheetXml, sharedStrings);

    if (maxRow === 0) {
      sheets.push({
        name: wbSheet.name,
        headers: [],
        rows: [],
        totalRows: 0,
        totalCols: 0,
      });
      continue;
    }

    // Build column letters for iteration
    const colLetters: string[] = [];
    for (let c = 0; c <= maxCol; c++) {
      let result = "";
      let n = c;
      while (n >= 0) {
        result = String.fromCharCode(65 + (n % 26)) + result;
        n = Math.floor(n / 26) - 1;
      }
      colLetters.push(result);
    }

    // Row 1 = headers
    const headers: string[] = colLetters.map((col) => {
      const val = cells.get(`${col}1`);
      return val != null ? String(val) : "";
    });

    // Remaining rows
    const rows: (string | number | boolean | null)[][] = [];
    for (let r = 2; r <= maxRow; r++) {
      const row: (string | number | boolean | null)[] = colLetters.map((col) => {
        const val = cells.get(`${col}${r}`);
        return val != null ? val : null;
      });
      rows.push(row);
    }

    sheets.push({
      name: wbSheet.name,
      headers,
      rows,
      totalRows: maxRow - 1, // exclude header
      totalCols: maxCol + 1,
    });
  }

  // Build markdown summary
  const mdParts: string[] = [];
  for (const sheet of sheets) {
    mdParts.push(`## ${sheet.name}`);
    mdParts.push(`${sheet.totalCols} columns, ${sheet.totalRows} data rows\n`);

    if (sheet.headers.length > 0) {
      // Markdown table (show up to 20 rows to keep output manageable)
      mdParts.push("| " + sheet.headers.join(" | ") + " |");
      mdParts.push("| " + sheet.headers.map(() => "---").join(" | ") + " |");

      const displayRows = sheet.rows.slice(0, 20);
      for (const row of displayRows) {
        const cells = row.map((v) => (v != null ? String(v) : ""));
        mdParts.push("| " + cells.join(" | ") + " |");
      }

      if (sheet.rows.length > 20) {
        mdParts.push(`\n*... ${sheet.rows.length - 20} more rows*`);
      }
    }
    mdParts.push("");
  }

  return {
    sheets,
    markdown: mdParts.join("\n"),
  };
}
