import { MAX_XLSX_COLUMN, MAX_XLSX_ROW, parseCellReference, parseRangeReference } from "./xlsx_references";
import type {
  XlsxCellStyle,
  XlsxCellValue,
  XlsxOptions,
  XlsxPatchOperation,
  XlsxSheet,
} from "./xlsx_types";
import { normalizeXlsxFormulaReferences } from "./xlsx_formula_normalization";
import { normalizeColumnFormats, normalizeConditionalFormats, normalizeDataValidations } from "./xlsx_rule_validation";

const MAX_SHEETS = 50;
const MAX_MATERIALIZED_CELLS = 1_000_000;
const MAX_STYLE_APPLICATIONS = 5_000_000;
const MAX_RULES_PER_KIND = 1_000;
const MAX_CELL_TEXT_LENGTH = 32_767;
const HEX_COLOR = /^[0-9A-F]{6}$/;
const NAMED_RANGE = /^[A-Za-z_\\][A-Za-z0-9_.]*$/;
export function sanitizeXlsxSheetName(value: string, fallback: string): string {
  const name = (value.trim() || fallback)
    .replace(/\p{Cc}/gu, "_")
    .replace(/[/\\?*[\]:]/g, "_")
    .replace(/^'+|'+$/g, "_")
    .slice(0, 31);
  if (!name) throw new Error("Worksheet names cannot be empty.");
  return name;
}
function validateCellValue(value: unknown, location: string): asserts value is XlsxCellValue {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`${location} must contain a finite number.`);
    }
    if (typeof value === "string" && value.length > MAX_CELL_TEXT_LENGTH) {
      throw new Error(`${location} exceeds Excel's ${MAX_CELL_TEXT_LENGTH.toLocaleString()} character limit.`);
    }
    return;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${location} contains an unsupported cell value.`);
  }
  const cell = value as Record<string, unknown>;
  if (cell.type === "text" && typeof cell.value === "string" && cell.value.length <= MAX_CELL_TEXT_LENGTH) return;
  if (cell.type === "date" && typeof cell.value === "string" && !Number.isNaN(Date.parse(cell.value))) return;
  if (cell.type === "formula" && typeof cell.formula === "string" && cell.formula.trim()) {
    const cached = cell.cachedValue;
    if (cell.formula.length > 8_192 || (typeof cached === "string" && cached.length > MAX_CELL_TEXT_LENGTH)) {
      throw new Error(`${location} exceeds an Excel formula or text limit.`);
    }
    if (cached === undefined || ["string", "boolean"].includes(typeof cached) ||
        (typeof cached === "number" && Number.isFinite(cached))) return;
  }
  throw new Error(`${location} has an invalid typed-cell payload.`);
}
function validateStyle(style: XlsxCellStyle, location: string): void {
  parseRangeReference(style.range);
  for (const [label, color] of [["fontColor", style.fontColor], ["bgColor", style.bgColor]] as const) {
    if (color !== undefined && !HEX_COLOR.test(color.replace(/^#/, "").toUpperCase())) {
      throw new Error(`${location}.${label} must be a six-digit RGB hex color.`);
    }
  }
  if (style.numberFormat !== undefined && style.numberFormat.length > 255) {
    throw new Error(`${location}.numberFormat is too long.`);
  }
  if (style.borderStyle !== undefined && !["thin", "medium", "thick"].includes(style.borderStyle)) {
    throw new Error(`${location}.borderStyle is invalid.`);
  }
  if (style.horizontalAlignment !== undefined &&
      !["left", "center", "right"].includes(style.horizontalAlignment)) {
    throw new Error(`${location}.horizontalAlignment is invalid.`);
  }
  if (style.verticalAlignment !== undefined &&
      !["top", "center", "bottom"].includes(style.verticalAlignment)) {
    throw new Error(`${location}.verticalAlignment is invalid.`);
  }
}
function validateRows(rows: unknown[][], width: number, location: string): XlsxCellValue[][] {
  let cells = 0;
  return rows.map((row, rowIndex) => {
    if (!Array.isArray(row)) throw new Error(`${location}[${rowIndex}] must be an array.`);
    if (row.length > width) {
      throw new Error(`${location}[${rowIndex}] has ${row.length} cells but the sheet has ${width} columns.`);
    }
    cells += row.length;
    if (cells > MAX_MATERIALIZED_CELLS) {
      throw new Error(`Workbook input exceeds ${MAX_MATERIALIZED_CELLS.toLocaleString()} cells.`);
    }
    row.forEach((value, colIndex) => validateCellValue(value, `${location}[${rowIndex}][${colIndex}]`));
    return row as XlsxCellValue[];
  });
}
function normalizeSheet(raw: Record<string, unknown>, index: number): XlsxSheet {
  const name = sanitizeXlsxSheetName(String(raw.name ?? ""), `Sheet${index + 1}`);
  const headers = Array.isArray(raw.headers) ? raw.headers.map((value) => String(value)) : [];
  if (headers.length === 0 || headers.length > MAX_XLSX_COLUMN) {
    throw new Error(`Worksheet "${name}" must have 1-${MAX_XLSX_COLUMN} headers.`);
  }
  if (headers.some((header) => header.length > MAX_CELL_TEXT_LENGTH)) {
    throw new Error(`Worksheet "${name}" contains a header that exceeds Excel's text limit.`);
  }
  const rawRows = Array.isArray(raw.rows) ? raw.rows as unknown[][] : [];
  if (rawRows.length + 1 > MAX_XLSX_ROW) {
    throw new Error(`Worksheet "${name}" exceeds Excel's row limit.`);
  }
  const rows = validateRows(rawRows, headers.length, `sheets[${index}].rows`);
  const columnWidths = Array.isArray(raw.columnWidths)
    ? raw.columnWidths.map((value) => Number(value))
    : undefined;
  if (columnWidths && (columnWidths.length !== headers.length ||
      columnWidths.some((width) => !Number.isFinite(width) || width < 1 || width > 255))) {
    throw new Error(`Worksheet "${name}" columnWidths must match headers and stay between 1 and 255.`);
  }
  const cellStyles = Array.isArray(raw.cellStyles) ? raw.cellStyles as XlsxCellStyle[] : undefined;
  if ((cellStyles?.length ?? 0) > MAX_RULES_PER_KIND) {
    throw new Error(`Worksheet "${name}" has too many cell style rules.`);
  }
  let styleApplications = 0;
  cellStyles?.forEach((style, styleIndex) => {
    validateStyle(style, `sheets[${index}].cellStyles[${styleIndex}]`);
    const range = parseRangeReference(style.range);
    const columns = Math.max(0, Math.min(range.endCol, headers.length - 1) - range.startCol + 1);
    const rowsInRange = Math.max(0, Math.min(range.endRow, rawRows.length + 1) - range.startRow + 1);
    styleApplications += columns * rowsInRange;
  });
  const columnFormats = normalizeColumnFormats(
    raw.columnFormats,
    headers.length,
    `sheets[${index}].columnFormats`,
  );
  styleApplications += (columnFormats?.length ?? 0) * rawRows.length;
  if (styleApplications > MAX_STYLE_APPLICATIONS) {
    throw new Error(`Worksheet "${name}" formatting spans too many cells.`);
  }
  const mergedCells = Array.isArray(raw.mergedCells) ? raw.mergedCells.map(String) : undefined;
  if ((mergedCells?.length ?? 0) > MAX_RULES_PER_KIND) {
    throw new Error(`Worksheet "${name}" has too many merged ranges.`);
  }
  mergedCells?.forEach(parseRangeReference);
  const autoFilter = typeof raw.autoFilter === "string" ? raw.autoFilter : undefined;
  if (autoFilter) parseRangeReference(autoFilter);
  const freezeRows = typeof raw.freezeRows === "number" ? Math.trunc(raw.freezeRows) : undefined;
  const freezeColumns = typeof raw.freezeColumns === "number" ? Math.trunc(raw.freezeColumns) : undefined;
  if ((freezeRows !== undefined && (freezeRows < 0 || freezeRows > rawRows.length + 1)) ||
      (freezeColumns !== undefined && (freezeColumns < 0 || freezeColumns > headers.length))) {
    throw new Error(`Worksheet "${name}" freeze panes are outside the used range.`);
  }
  const rowHeights = Array.isArray(raw.rowHeights) ? raw.rowHeights as NonNullable<XlsxSheet["rowHeights"]> : undefined;
  rowHeights?.forEach((item, heightIndex) => {
    if (!Number.isInteger(item.row) || item.row < 1 || item.row > rawRows.length + 1 ||
        !Number.isFinite(item.height) || item.height < 1 || item.height > 409) {
      throw new Error(`sheets[${index}].rowHeights[${heightIndex}] is invalid.`);
    }
  });
  const conditionalFormats = normalizeConditionalFormats(
    raw.conditionalFormats,
    `sheets[${index}].conditionalFormats`,
  );
  const dataValidations = normalizeDataValidations(
    raw.dataValidations,
    `sheets[${index}].dataValidations`,
  );
  return {
    name,
    headers,
    rows,
    columnWidths,
    cellStyles,
    columnFormats,
    mergedCells,
    autoFilter,
    freezeHeader: typeof raw.freezeHeader === "boolean" ? raw.freezeHeader : undefined,
    freezeRows,
    freezeColumns,
    rowHeights,
    conditionalFormats,
    dataValidations,
  };
}
export function normalizeXlsxOptions(args: {
  title: unknown;
  sheets: unknown;
  namedRanges?: unknown;
}): XlsxOptions {
  const title = String(args.title ?? "").trim();
  if (!title) throw new Error("Missing or invalid 'title'.");
  if (!Array.isArray(args.sheets) || args.sheets.length === 0) {
    throw new Error("At least one sheet is required.");
  }
  if (args.sheets.length > MAX_SHEETS) {
    throw new Error(`Provide no more than ${MAX_SHEETS} worksheets.`);
  }
  const sheets = args.sheets.map((sheet, index) => {
    if (typeof sheet !== "object" || sheet === null || Array.isArray(sheet)) {
      throw new Error(`sheets[${index}] must be an object.`);
    }
    return normalizeSheet(sheet as Record<string, unknown>, index);
  });
  const workbookCells = sheets.reduce(
    (sum, sheet) => sum + sheet.headers.length * (sheet.rows.length + 1),
    0,
  );
  if (workbookCells > MAX_MATERIALIZED_CELLS) {
    throw new Error(`Workbook input exceeds ${MAX_MATERIALIZED_CELLS.toLocaleString()} table cells.`);
  }
  const seen = new Set<string>();
  for (const sheet of sheets) {
    const key = sheet.name.toLocaleLowerCase();
    if (seen.has(key)) throw new Error(`Worksheet names must be unique: "${sheet.name}".`);
    seen.add(key);
  }
  const namedRanges = Array.isArray(args.namedRanges)
    ? args.namedRanges.map((raw, index) => {
        const item = raw as Record<string, unknown>;
        const name = String(item.name ?? "");
        const range = String(item.range ?? "");
        const reference = range.match(/^('(?:[^']|'')+'|[^!]+)!(\$?[A-Za-z]+\$?\d+(?::\$?[A-Za-z]+\$?\d+)?)$/);
        const sheetName = reference?.[1].startsWith("'")
          ? reference[1].slice(1, -1).replace(/''/g, "'")
          : reference?.[1];
        if (!NAMED_RANGE.test(name) || !reference || !sheetName ||
            !sheets.some((sheet) => sheet.name.toLocaleLowerCase() === sheetName.toLocaleLowerCase())) {
          throw new Error(`namedRanges[${index}] is invalid.`);
        }
        parseRangeReference(reference[2]);
        return { name, range };
      })
    : undefined;
  const rangeNames = new Set<string>();
  for (const range of namedRanges ?? []) {
    const key = range.name.toLocaleLowerCase();
    if (rangeNames.has(key)) throw new Error(`Named ranges must be unique: "${range.name}".`);
    rangeNames.add(key);
  }
  return normalizeXlsxFormulaReferences({ title, sheets, namedRanges });
}

export function normalizeXlsxPatchOperations(value: unknown): XlsxPatchOperation[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error("Provide between 1 and 100 workbook patch operations.");
  }
  let totalCells = 0;
  return value.map((raw, index) => {
    const operation = raw as Record<string, unknown>;
    const sheet = String(operation.sheet ?? "").trim();
    if (!sheet) throw new Error(`operations[${index}].sheet is required.`);
    if (operation.type === "setCells") {
      const startCell = String(operation.startCell ?? "");
      const start = parseCellReference(startCell);
      const rows = Array.isArray(operation.rows) ? operation.rows as unknown[][] : [];
      const width = Math.max(0, ...rows.map((row) => Array.isArray(row) ? row.length : 0));
      if (rows.length === 0 || width === 0 || start.row + rows.length - 1 > MAX_XLSX_ROW ||
          start.col + width > MAX_XLSX_COLUMN) throw new Error(`operations[${index}] is outside worksheet bounds.`);
      totalCells += rows.length * width;
      if (totalCells > MAX_MATERIALIZED_CELLS) throw new Error("Workbook patch exceeds the cell limit.");
      return { type: "setCells", sheet, startCell, rows: validateRows(rows, width, `operations[${index}].rows`) };
    }
    if (operation.type === "clearRange") {
      const range = String(operation.range ?? "");
      parseRangeReference(range);
      return { type: "clearRange", sheet, range };
    }
    if (operation.type === "appendRows") {
      const rows = Array.isArray(operation.rows) ? operation.rows as unknown[][] : [];
      const width = Math.max(0, ...rows.map((row) => Array.isArray(row) ? row.length : 0));
      if (rows.length === 0 || width === 0) throw new Error(`operations[${index}].rows cannot be empty.`);
      const startColumn = operation.startColumn === undefined ? undefined : Number(operation.startColumn);
      if (startColumn !== undefined && (!Number.isInteger(startColumn) || startColumn < 0 ||
          startColumn + width > MAX_XLSX_COLUMN)) {
        throw new Error(`operations[${index}].startColumn is invalid.`);
      }
      totalCells += rows.length * width;
      if (totalCells > MAX_MATERIALIZED_CELLS) throw new Error("Workbook patch exceeds the cell limit.");
      return {
        type: "appendRows",
        sheet,
        rows: validateRows(rows, width, `operations[${index}].rows`),
        startColumn,
      };
    }
    if (operation.type === "renameSheet") {
      return {
        type: "renameSheet",
        sheet,
        newName: sanitizeXlsxSheetName(String(operation.newName ?? ""), "Sheet"),
      };
    }
    throw new Error(`operations[${index}].type is unsupported.`);
  });
}
