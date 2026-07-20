import { cellReference, parseRangeReference } from "./xlsx_references";
import type { XlsxCellStyle, XlsxCellValue, XlsxSheet } from "./xlsx_types";
import { escapeXlsxXml } from "./xlsx_xml";
import {
  DEFAULT_XLSX_STYLE,
  HEADER_XLSX_STYLE,
  XlsxStyleRegistry,
  type XlsxStyleSpec,
} from "./xlsx_writer_styles";

export class XlsxSharedStrings {
  private readonly indexes = new Map<string, number>();
  private readonly values: string[] = [];
  private references = 0;

  index(value: string): number {
    this.references += 1;
    const existing = this.indexes.get(value);
    if (existing !== undefined) return existing;
    const index = this.values.length;
    this.indexes.set(value, index);
    this.values.push(value);
    return index;
  }

  toXml(): string {
    const values = this.values.map((value) =>
      `<si><t xml:space="preserve">${escapeXlsxXml(value)}</t></si>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      `count="${this.references}" uniqueCount="${this.values.length}">${values}</sst>`;
  }
}

function applyStyle(base: XlsxStyleSpec, override: XlsxCellStyle, registry: XlsxStyleRegistry): XlsxStyleSpec {
  return {
    bold: override.bold ?? base.bold,
    fontColor: override.fontColor?.replace(/^#/, "").toUpperCase() ?? base.fontColor,
    bgColor: override.bgColor?.replace(/^#/, "").toUpperCase() ?? base.bgColor,
    borderStyle: override.borderStyle ?? base.borderStyle,
    numFmtId: override.numberFormat ? registry.getNumFmtId(override.numberFormat) : base.numFmtId,
    horizontalAlignment: override.horizontalAlignment ?? base.horizontalAlignment,
    verticalAlignment: override.verticalAlignment ?? base.verticalAlignment,
    wrapText: override.wrapText ?? base.wrapText,
  };
}

function styleMap(sheet: XlsxSheet, registry: XlsxStyleRegistry): Map<string, number> {
  const maxRow = sheet.rows.length + 1;
  const maxCol = sheet.headers.length - 1;
  const specs = new Map<string, XlsxStyleSpec>();
  for (let col = 0; col <= maxCol; col++) specs.set(`${col},1`, { ...HEADER_XLSX_STYLE });
  for (const format of sheet.columnFormats ?? []) {
    if (format.column < 0 || format.column > maxCol) continue;
    const numFmtId = registry.getNumFmtId(format.format);
    for (let row = 2; row <= maxRow; row++) {
      specs.set(`${format.column},${row}`, { ...DEFAULT_XLSX_STYLE, numFmtId });
    }
  }
  for (const override of sheet.cellStyles ?? []) {
    const range = parseRangeReference(override.range);
    for (let row = range.startRow; row <= Math.min(range.endRow, maxRow); row++) {
      for (let col = range.startCol; col <= Math.min(range.endCol, maxCol); col++) {
        const key = `${col},${row}`;
        const base = specs.get(key) ?? (row === 1 ? HEADER_XLSX_STYLE : DEFAULT_XLSX_STYLE);
        specs.set(key, applyStyle(base, override, registry));
      }
    }
  }
  return new Map(Array.from(specs, ([key, spec]) => [key, registry.getStyleId(spec)]));
}

function cachedValueXml(value: string | number | boolean): string {
  if (typeof value === "boolean") return `<v>${value ? 1 : 0}</v>`;
  return `<v>${escapeXlsxXml(String(value))}</v>`;
}

function cachedValueType(value: string | number | boolean): string {
  if (typeof value === "boolean") return ` t="b"`;
  if (typeof value === "string") return ` t="str"`;
  return "";
}

function cellXml(
  reference: string,
  value: XlsxCellValue,
  styleId: number,
  sharedStrings: XlsxSharedStrings,
): string {
  const style = styleId > 0 ? ` s="${styleId}"` : "";
  if (typeof value === "number") return `<c r="${reference}"${style}><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${reference}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
  if (typeof value === "string") {
    if (value.startsWith("=")) return `<c r="${reference}"${style}><f>${escapeXlsxXml(value.slice(1))}</f></c>`;
    return `<c r="${reference}" t="s"${style}><v>${sharedStrings.index(value)}</v></c>`;
  }
  if (value === null) return "";
  if (value.type === "text") {
    return `<c r="${reference}" t="s"${style}><v>${sharedStrings.index(value.value)}</v></c>`;
  }
  if (value.type === "date") {
    return `<c r="${reference}" t="d"${style}><v>${escapeXlsxXml(new Date(value.value).toISOString())}</v></c>`;
  }
  const formula = value.formula.replace(/^=/, "");
  const cached = value.cachedValue === undefined ? "" : cachedValueXml(value.cachedValue);
  const type = value.cachedValue === undefined ? "" : cachedValueType(value.cachedValue);
  return `<c r="${reference}"${type}${style}><f>${escapeXlsxXml(formula)}</f>${cached}</c>`;
}

function columnWidths(sheet: XlsxSheet): number[] {
  if (sheet.columnWidths) return sheet.columnWidths;
  const widths = sheet.headers.map((header) => Math.min(50, Math.max(8, header.length + 2)));
  for (const row of sheet.rows) {
    row.forEach((value, index) => {
      if (value === null || index >= widths.length) return;
      const display = typeof value === "object"
        ? value.type === "formula" ? value.cachedValue ?? value.formula : value.value
        : value;
      widths[index] = Math.min(50, Math.max(widths[index], String(display).length + 2));
    });
  }
  return widths;
}

function sheetViewXml(sheet: XlsxSheet): string {
  const rows = Math.max(0, Math.trunc(sheet.freezeRows ?? (sheet.freezeHeader === false ? 0 : 1)));
  const columns = Math.max(0, Math.trunc(sheet.freezeColumns ?? 0));
  if (rows === 0 && columns === 0) {
    return `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  }
  const activePane = rows > 0 && columns > 0 ? "bottomRight" : rows > 0 ? "bottomLeft" : "topRight";
  const pane = `<pane${columns ? ` xSplit="${columns}"` : ""}${rows ? ` ySplit="${rows}"` : ""} ` +
    `topLeftCell="${cellReference(columns, rows + 1)}" activePane="${activePane}" state="frozen"/>`;
  return `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>`;
}

function conditionalFormattingXml(sheet: XlsxSheet, registry: XlsxStyleRegistry): string {
  return (sheet.conditionalFormats ?? []).map((rule, index) => {
    const dxfId = registry.getDifferentialStyleId(
      rule.fontColor?.replace(/^#/, "").toUpperCase(),
      rule.bgColor?.replace(/^#/, "").toUpperCase(),
    );
    const range = parseRangeReference(rule.range);
    const cell = cellReference(range.startCol, range.startRow);
    const first = rule.formula.replace(/^=/, "");
    const second = rule.formula2?.replace(/^=/, "");
    const comparison = rule.operator === "between"
      ? `${cell}>=${first},${cell}<=${second}`
      : `${cell}${({ greaterThan: ">", lessThan: "<", equal: "=", notEqual: "<>" } as const)[rule.operator]}${first}`;
    const formula = `AND(NOT(ISBLANK(${cell})),${comparison})`;
    return `<conditionalFormatting sqref="${escapeXlsxXml(rule.range)}">` +
      `<cfRule type="expression" dxfId="${dxfId}" priority="${index + 1}">` +
      `<formula>${escapeXlsxXml(formula)}</formula></cfRule>` +
      `</conditionalFormatting>`;
  }).join("");
}

function dataValidationsXml(sheet: XlsxSheet): string {
  const validations = sheet.dataValidations ?? [];
  if (validations.length === 0) return "";
  const items = validations.map((rule) =>
    `<dataValidation type="${rule.type}" sqref="${escapeXlsxXml(rule.range)}"` +
    `${rule.operator ? ` operator="${rule.operator}"` : ""}` +
    ` allowBlank="${rule.allowBlank === false ? 0 : 1}" showErrorMessage="1" showInputMessage="1"` +
    `${rule.prompt ? ` prompt="${escapeXlsxXml(rule.prompt)}"` : ""}` +
    `${rule.error ? ` error="${escapeXlsxXml(rule.error)}"` : ""}>` +
    `<formula1>${escapeXlsxXml(rule.formula1.replace(/^=/, ""))}</formula1>` +
    `${rule.formula2 ? `<formula2>${escapeXlsxXml(rule.formula2.replace(/^=/, ""))}</formula2>` : ""}` +
    `</dataValidation>`).join("");
  return `<dataValidations count="${validations.length}">${items}</dataValidations>`;
}

export function buildXlsxSheetXml(
  sheet: XlsxSheet,
  sharedStrings: XlsxSharedStrings,
  registry: XlsxStyleRegistry,
): string {
  const styles = styleMap(sheet, registry);
  const rows: string[] = [];
  const heights = new Map((sheet.rowHeights ?? []).map((item) => [item.row, item.height]));
  const headerCells = sheet.headers.map((header, col) =>
    cellXml(cellReference(col, 1), header, styles.get(`${col},1`) ?? 1, sharedStrings)).join("");
  const headerHeight = heights.get(1);
  rows.push(`<row r="1"${headerHeight ? ` ht="${headerHeight}" customHeight="1"` : ""}>${headerCells}</row>`);
  sheet.rows.forEach((values, index) => {
    const rowNumber = index + 2;
    const cells = values.map((value, col) =>
      cellXml(cellReference(col, rowNumber), value, styles.get(`${col},${rowNumber}`) ?? 0, sharedStrings)).join("");
    const height = heights.get(rowNumber);
    rows.push(`<row r="${rowNumber}"${height ? ` ht="${height}" customHeight="1"` : ""}>${cells}</row>`);
  });
  const columns = columnWidths(sheet).map((width, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${width}" bestFit="1" customWidth="1"/>`).join("");
  const dimension = `A1:${cellReference(sheet.headers.length - 1, sheet.rows.length + 1)}`;
  const merges = sheet.mergedCells?.length
    ? `<mergeCells count="${sheet.mergedCells.length}">` +
      sheet.mergedCells.map((range) => `<mergeCell ref="${escapeXlsxXml(range)}"/>`).join("") +
      `</mergeCells>`
    : "";
  const filter = sheet.autoFilter ? `<autoFilter ref="${escapeXlsxXml(sheet.autoFilter)}"/>` : "";
  const conditionalFormatting = conditionalFormattingXml(sheet, registry);
  const dataValidations = dataValidationsXml(sheet);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="${dimension}"/>${sheetViewXml(sheet)}<cols>${columns}</cols>` +
    `<sheetData>${rows.join("")}</sheetData>${filter}${merges}${conditionalFormatting}${dataValidations}</worksheet>`;
}
