import {
  MAX_XLSX_COLUMN,
  columnIndex,
  columnLetter,
  parseCellReference,
} from "./xlsx_references";
import {
  getXlsxAttribute,
  getXlsxElements,
  getXlsxInnerXml,
  getXlsxText,
  unescapeXlsxXml,
} from "./xlsx_xml";

export type ParsedXlsxValue = string | number | boolean;

export interface ParsedXlsxCell {
  col: number;
  row: number;
  value: ParsedXlsxValue;
  formula?: string;
  cachedValue?: ParsedXlsxValue;
}

export interface ParsedWorkbookSheet {
  name: string;
  relationshipId: string;
  state?: string;
}

export interface ParsedXlsxStyles {
  dateStyleIds: Set<number>;
}

const BUILTIN_DATE_FORMAT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

function isDateFormat(format: string): boolean {
  const normalized = format
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*]/g, "")
    .toLowerCase();
  return /(^|[^a-z])[dmyhs]+([^a-z]|$)/.test(normalized);
}

export function parseXlsxStyles(xml: string | undefined): ParsedXlsxStyles {
  if (!xml) return { dateStyleIds: new Set() };
  const customFormats = new Map<number, string>();
  for (const element of getXlsxElements(xml, "numFmt")) {
    const id = Number(getXlsxAttribute(element, "numFmtId"));
    const code = getXlsxAttribute(element, "formatCode");
    if (Number.isInteger(id) && code) customFormats.set(id, code);
  }
  const cellXfsXml = getXlsxInnerXml(xml, "cellXfs") ?? "";
  const dateStyleIds = new Set<number>();
  getXlsxElements(cellXfsXml, "xf").forEach((element, styleId) => {
    const formatId = Number(getXlsxAttribute(element, "numFmtId") ?? 0);
    const custom = customFormats.get(formatId);
    if (BUILTIN_DATE_FORMAT_IDS.has(formatId) || (custom !== undefined && isDateFormat(custom))) {
      dateStyleIds.add(styleId);
    }
  });
  return { dateStyleIds };
}

export function parseXlsxSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return getXlsxElements(xml, "si").map((item) =>
    getXlsxElements(item, "t")
      .map((text) => unescapeXlsxXml((getXlsxInnerXml(text, "t") ?? "").replace(/<[^>]+>/g, "")))
      .join(""));
}

export function parseXlsxWorkbook(xml: string): {
  sheets: ParsedWorkbookSheet[];
  date1904: boolean;
} {
  const workbookProperties = getXlsxElements(xml, "workbookPr")[0];
  const date1904 = workbookProperties !== undefined &&
    ["1", "true"].includes((getXlsxAttribute(workbookProperties, "date1904") ?? "").toLowerCase());
  const sheets = getXlsxElements(xml, "sheet").flatMap((element) => {
    const name = getXlsxAttribute(element, "name");
    const relationshipId = getXlsxAttribute(element, "r:id");
    if (!name || !relationshipId) return [];
    const state = getXlsxAttribute(element, "state") ?? undefined;
    return [{ name, relationshipId, state }];
  });
  return { sheets, date1904 };
}

export function parseXlsxRelationships(xml: string | undefined): Map<string, string> {
  const relationships = new Map<string, string>();
  if (!xml) return relationships;
  for (const element of getXlsxElements(xml, "Relationship")) {
    const id = getXlsxAttribute(element, "Id");
    const target = getXlsxAttribute(element, "Target");
    if (id && target) relationships.set(id, target);
  }
  return relationships;
}

export function resolveXlsxRelationshipPath(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `xl/${target}`.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "." || !part) continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

function excelSerialToIso(value: number, date1904: boolean): string {
  if (!date1904 && Math.trunc(value) === 60) {
    const fraction = value - Math.trunc(value);
    if (Math.abs(fraction) < Number.EPSILON) return "1900-02-29";
    return `1900-02-29T${new Date(fraction * 86_400_000).toISOString().slice(11)}`;
  }
  const epoch = date1904
    ? Date.UTC(1904, 0, 1)
    : Date.UTC(1899, 11, value < 60 ? 31 : 30);
  const date = new Date(epoch + value * 86_400_000);
  if (Number.isNaN(date.getTime())) return String(value);
  const iso = date.toISOString();
  return Math.abs(value - Math.trunc(value)) < Number.EPSILON ? iso.slice(0, 10) : iso;
}

function translateSharedFormula(
  formula: string,
  master: { col: number; row: number },
  target: { col: number; row: number },
): string {
  const colOffset = target.col - master.col;
  const rowOffset = target.row - master.row;
  return formula.split(/("(?:[^"]|"")*")/).map((part, index) => {
    if (index % 2 === 1) return part;
    return part.replace(
      /(^|[^A-Z0-9_.])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Z0-9_(])/gi,
      (_, prefix, colLock, letters, rowLock, digits) => {
        const col = columnIndex(letters) + (colLock ? 0 : colOffset);
        const row = Number(digits) + (rowLock ? 0 : rowOffset);
        if (col < 0 || col >= MAX_XLSX_COLUMN || row < 1) return `${prefix}#REF!`;
        return `${prefix}${colLock}${columnLetter(col)}${rowLock}${row}`;
      },
    );
  }).join("");
}

function parseCachedValue(
  raw: string,
  type: string | null,
  styleId: number,
  styles: ParsedXlsxStyles,
  date1904: boolean,
): ParsedXlsxValue {
  if (type === "b") return raw === "1";
  if (type === "str" || type === "e" || type === "d") return raw;
  const numeric = Number(raw);
  if (!Number.isNaN(numeric)) {
    return styles.dateStyleIds.has(styleId) ? excelSerialToIso(numeric, date1904) : numeric;
  }
  return unescapeXlsxXml(raw);
}

export function parseXlsxSheetCells(
  xml: string,
  sharedStrings: string[],
  styles: ParsedXlsxStyles,
  date1904: boolean,
  includeFormulas: boolean,
): { cells: Map<string, ParsedXlsxCell>; maxCol: number; maxRow: number } {
  const cells = new Map<string, ParsedXlsxCell>();
  const sharedFormulas = new Map<string, { formula: string; col: number; row: number }>();
  for (const cellXml of getXlsxElements(xml, "c")) {
    const formulaElement = getXlsxElements(cellXml, "f")[0];
    const reference = getXlsxAttribute(cellXml, "r");
    if (!formulaElement || !reference || getXlsxAttribute(formulaElement, "t") !== "shared") continue;
    const sharedIndex = getXlsxAttribute(formulaElement, "si");
    const formula = getXlsxText(formulaElement, "f");
    if (!sharedIndex || !formula) continue;
    try {
      const parsed = parseCellReference(reference);
      sharedFormulas.set(sharedIndex, { formula, ...parsed });
    } catch {
      // Invalid cell references are ignored below as well.
    }
  }
  let maxCol = -1;
  let maxRow = 0;
  for (const rowXml of getXlsxElements(xml, "row")) {
    for (const cellXml of getXlsxElements(rowXml, "c")) {
      const reference = getXlsxAttribute(cellXml, "r");
      if (!reference) continue;
      let parsedReference;
      try {
        parsedReference = parseCellReference(reference);
      } catch {
        continue;
      }
      const type = getXlsxAttribute(cellXml, "t");
      const styleId = Number(getXlsxAttribute(cellXml, "s") ?? 0);
      const rawValue = getXlsxText(cellXml, "v");
      const formulaElement = getXlsxElements(cellXml, "f")[0];
      let formulaText = formulaElement ? getXlsxText(formulaElement, "f") : "";
      if (!formulaText && formulaElement && getXlsxAttribute(formulaElement, "t") === "shared") {
        const master = sharedFormulas.get(getXlsxAttribute(formulaElement, "si") ?? "");
        if (master) formulaText = translateSharedFormula(master.formula, master, parsedReference);
      }
      if (type !== "s" && type !== "inlineStr" && !formulaElement &&
          getXlsxElements(cellXml, "v").length === 0) {
        maxCol = Math.max(maxCol, parsedReference.col);
        maxRow = Math.max(maxRow, parsedReference.row);
        continue;
      }
      let cachedValue: ParsedXlsxValue | undefined;
      let value: ParsedXlsxValue;
      if (type === "s") {
        value = sharedStrings[Number(rawValue)] ?? "";
      } else if (type === "inlineStr") {
        value = getXlsxElements(cellXml, "t")
          .map((text) => getXlsxText(text, "t"))
          .join("");
      } else {
        cachedValue = rawValue === "" ? undefined :
          parseCachedValue(rawValue, type, styleId, styles, date1904);
        value = formulaText && includeFormulas ? `=${formulaText}` : cachedValue ?? "";
      }
      const key = `${parsedReference.col},${parsedReference.row}`;
      cells.set(key, {
        col: parsedReference.col,
        row: parsedReference.row,
        value,
        formula: formulaText || undefined,
        cachedValue,
      });
      maxCol = Math.max(maxCol, parsedReference.col);
      maxRow = Math.max(maxRow, parsedReference.row);
    }
  }
  return { cells, maxCol, maxRow };
}

export function xlsxColumnIndexFromReference(reference: string): number {
  return columnIndex(reference.replace(/[^A-Za-z]/g, ""));
}
