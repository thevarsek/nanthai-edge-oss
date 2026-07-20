import JSZip from "jszip";
import {
  formatRangeReference,
  parseRangeReference,
  type XlsxRangeReference,
} from "./xlsx_references";
import {
  parseXlsxRelationships,
  parseXlsxSharedStrings,
  parseXlsxSheetCells,
  parseXlsxStyles,
  parseXlsxWorkbook,
  resolveXlsxRelationshipPath,
  type ParsedXlsxValue,
} from "./xlsx_reader_parsing";

const DEFAULT_READ_LIMIT = 200;
const MAX_READ_LIMIT = 2_000;
const MAX_MATERIALIZED_CELLS = 1_000_000;

export interface XlsxReadOptions {
  sheet?: string;
  range?: string;
  offset?: number;
  limit?: number;
  search?: string;
  includeFormulas?: boolean;
}

export interface XlsxSheetData {
  name: string;
  state?: string;
  headers: string[];
  rows: (ParsedXlsxValue | null)[][];
  rowNumbers: number[];
  totalRows: number;
  totalCols: number;
  returnedRows: number;
  offset: number;
  hasMore: boolean;
  nextOffset?: number;
  range: string;
}

export interface XlsxExtraction {
  sheets: XlsxSheetData[];
  markdown: string;
}

function normalizedWindow(options: XlsxReadOptions, maxCol: number, maxRow: number): XlsxRangeReference {
  if (options.range) return parseRangeReference(options.range);
  return {
    startCol: 0,
    startRow: 1,
    endCol: Math.max(0, maxCol),
    endRow: Math.max(1, maxRow),
  };
}

function markdownCell(value: ParsedXlsxValue | null): string {
  return value === null ? "" : String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function sheetMarkdown(sheet: XlsxSheetData): string {
  const lines = [
    `## ${sheet.name}`,
    `${sheet.totalCols} columns, ${sheet.totalRows} data rows; showing ${sheet.returnedRows} from offset ${sheet.offset}.`,
    "",
  ];
  if (sheet.headers.length > 0) {
    lines.push(`| ${sheet.headers.map(markdownCell).join(" | ")} |`);
    lines.push(`| ${sheet.headers.map(() => "---").join(" | ")} |`);
    for (const row of sheet.rows.slice(0, 20)) {
      lines.push(`| ${row.map(markdownCell).join(" | ")} |`);
    }
    if (sheet.rows.length > 20) lines.push(`\n*... ${sheet.rows.length - 20} more returned rows*`);
    if (sheet.hasMore) lines.push(`\n*More rows available at offset ${sheet.nextOffset}.*`);
  }
  return lines.join("\n");
}

function materializeSheet(
  name: string,
  state: string | undefined,
  parsed: ReturnType<typeof parseXlsxSheetCells>,
  options: XlsxReadOptions,
): XlsxSheetData {
  if (parsed.maxRow === 0 || parsed.maxCol < 0) {
    return {
      name, state, headers: [], rows: [], rowNumbers: [], totalRows: 0, totalCols: 0,
      returnedRows: 0, offset: 0, hasMore: false, range: "A1:A1",
    };
  }
  const window = normalizedWindow(options, parsed.maxCol, parsed.maxRow);
  const width = window.endCol - window.startCol + 1;
  const headerRow = window.startRow;
  const headers = Array.from({ length: width }, (_, index) => {
    const value = parsed.cells.get(`${window.startCol + index},${headerRow}`)?.value;
    return value === undefined ? "" : String(value);
  });
  const allRowNumbers: number[] = [];
  const search = options.search?.trim().toLocaleLowerCase();
  for (let row = headerRow + 1; row <= Math.min(window.endRow, parsed.maxRow); row++) {
    if (search) {
      const matches = Array.from({ length: width }, (_, index) =>
        parsed.cells.get(`${window.startCol + index},${row}`)?.value)
        .some((value) => value !== undefined && String(value).toLocaleLowerCase().includes(search));
      if (!matches) continue;
    }
    allRowNumbers.push(row);
  }
  const offset = Math.min(Math.max(0, Math.trunc(options.offset ?? 0)), allRowNumbers.length);
  const requestedLimit = options.limit === undefined ? DEFAULT_READ_LIMIT : Math.trunc(options.limit);
  const limit = Math.min(MAX_READ_LIMIT, Math.max(1, requestedLimit || DEFAULT_READ_LIMIT));
  const rowNumbers = allRowNumbers.slice(offset, offset + limit);
  if (rowNumbers.length * width > MAX_MATERIALIZED_CELLS) {
    throw new Error("Requested XLSX range is too large; request a smaller range or page size.");
  }
  const rows = rowNumbers.map((row) =>
    Array.from({ length: width }, (_, index) =>
      parsed.cells.get(`${window.startCol + index},${row}`)?.value ?? null));
  const hasMore = offset + rowNumbers.length < allRowNumbers.length;
  return {
    name,
    state,
    headers,
    rows,
    rowNumbers,
    totalRows: allRowNumbers.length,
    totalCols: width,
    returnedRows: rows.length,
    offset,
    hasMore,
    nextOffset: hasMore ? offset + rows.length : undefined,
    range: formatRangeReference({
      startCol: window.startCol,
      startRow: headerRow,
      endCol: window.endCol,
      endRow: rowNumbers.at(-1) ?? headerRow,
    }),
  };
}

export async function extractXlsx(
  data: ArrayBuffer,
  options: XlsxReadOptions = {},
): Promise<XlsxExtraction> {
  const zip = await JSZip.loadAsync(data);
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  if (!workbookXml) return { sheets: [], markdown: "(Empty or invalid .xlsx file)" };
  const workbook = parseXlsxWorkbook(workbookXml);
  const relationships = parseXlsxRelationships(
    await zip.file("xl/_rels/workbook.xml.rels")?.async("string"),
  );
  const sharedStrings = parseXlsxSharedStrings(
    await zip.file("xl/sharedStrings.xml")?.async("string"),
  );
  const styles = parseXlsxStyles(await zip.file("xl/styles.xml")?.async("string"));
  const selected = options.sheet
    ? workbook.sheets.filter((sheet) => sheet.name.toLocaleLowerCase() === options.sheet?.toLocaleLowerCase())
    : workbook.sheets;
  if (options.sheet && selected.length === 0) {
    throw new Error(`Worksheet "${options.sheet}" was not found.`);
  }
  const sheets: XlsxSheetData[] = [];
  let returnedCells = 0;
  for (const sheet of selected) {
    const target = relationships.get(sheet.relationshipId);
    if (!target) continue;
    const xml = await zip.file(resolveXlsxRelationshipPath(target))?.async("string");
    if (!xml) continue;
    const parsed = parseXlsxSheetCells(
      xml,
      sharedStrings,
      styles,
      workbook.date1904,
      options.includeFormulas !== false,
    );
    const materialized = materializeSheet(sheet.name, sheet.state, parsed, options);
    returnedCells += materialized.headers.length + materialized.rows.length * materialized.totalCols;
    if (returnedCells > MAX_MATERIALIZED_CELLS) {
      throw new Error("Requested XLSX pages are too large; select one sheet or a smaller range.");
    }
    sheets.push(materialized);
  }
  return { sheets, markdown: sheets.map(sheetMarkdown).join("\n\n") };
}

export function xlsxReadDefaults(): { limit: number } {
  return { limit: DEFAULT_READ_LIMIT };
}
