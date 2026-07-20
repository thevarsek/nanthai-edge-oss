import JSZip from "jszip";
import { normalizeXlsxPatchFormulaReferences } from "./xlsx_formula_normalization";
import {
  cellReference,
  formatRangeReference,
  parseCellReference,
  parseRangeReference,
} from "./xlsx_references";
import {
  parseXlsxRelationships,
  parseXlsxWorkbook,
  resolveXlsxRelationshipPath,
  type ParsedWorkbookSheet,
} from "./xlsx_reader_parsing";
import type { XlsxCellValue, XlsxPatchOperation } from "./xlsx_types";
import {
  escapeXlsxXml,
  getXlsxAttribute,
  getXlsxElements,
  replaceXlsxAttribute,
  unescapeXlsxXml,
} from "./xlsx_xml";

interface PatchRow {
  row: number;
  openingTag: string;
  residualXml: string;
  cells: Map<number, string>;
}

interface PatchSheet {
  path: string;
  xml: string;
  rows: Map<number, PatchRow>;
}

function parsePatchRows(xml: string): Map<number, PatchRow> {
  const rows = new Map<number, PatchRow>();
  const sheetData = xml.match(/<sheetData(?:\s[^>]*)?>([\s\S]*?)<\/sheetData>/)?.[1] ?? "";
  for (const rowXml of getXlsxElements(sheetData, "row")) {
    const opening = rowXml.match(/^<row\b[^>]*>/)?.[0] ?? "<row>";
    const rowNumber = Number(getXlsxAttribute(opening, "r"));
    if (!Number.isInteger(rowNumber) || rowNumber < 1) continue;
    const inner = rowXml.endsWith("/>") ? "" : rowXml.slice(opening.length, -"</row>".length);
    const cells = new Map<number, string>();
    let residualXml = inner;
    for (const cellXml of getXlsxElements(inner, "c")) {
      const reference = getXlsxAttribute(cellXml, "r");
      if (!reference) continue;
      try {
        cells.set(parseCellReference(reference).col, cellXml);
        residualXml = residualXml.replace(cellXml, "");
      } catch {
        // Preserve malformed or non-A1 cells in residual XML.
      }
    }
    rows.set(rowNumber, { row: rowNumber, openingTag: opening, residualXml, cells });
  }
  return rows;
}

function styleAttribute(existing: string | undefined): string {
  const style = existing ? getXlsxAttribute(existing, "s") : null;
  return style ? ` s="${escapeXlsxXml(style)}"` : "";
}

function formulaCache(value: string | number | boolean): { type: string; xml: string } {
  if (typeof value === "boolean") return { type: ` t="b"`, xml: `<v>${value ? 1 : 0}</v>` };
  if (typeof value === "string") return { type: ` t="str"`, xml: `<v>${escapeXlsxXml(value)}</v>` };
  return { type: "", xml: `<v>${value}</v>` };
}

function clearedCellXml(reference: string, existing?: string): string {
  if (!existing) return "";
  const opening = existing.match(/^<c\b[^>]*\/?>/)?.[0]
    .replace(/\s+t=["'][^"']*["']/, "")
    .replace(/\/?>$/, ">");
  if (!opening || !/\s(?:s|cm|vm|ph)=["']/.test(opening)) return "";
  return `${replaceXlsxAttribute(opening, "r", reference).replace(/>$/, "")}/>`;
}

function patchedCellXml(reference: string, value: XlsxCellValue, existing?: string): string {
  const style = styleAttribute(existing);
  if (typeof value === "number") return `<c r="${reference}"${style}><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${reference}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
  if (typeof value === "string") {
    if (value.startsWith("=")) return `<c r="${reference}"${style}><f>${escapeXlsxXml(value.slice(1))}</f></c>`;
    return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXlsxXml(value)}</t></is></c>`;
  }
  if (value === null) return clearedCellXml(reference, existing);
  if (value.type === "text") {
    return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXlsxXml(value.value)}</t></is></c>`;
  }
  if (value.type === "date") {
    return `<c r="${reference}" t="d"${style}><v>${escapeXlsxXml(new Date(value.value).toISOString())}</v></c>`;
  }
  const cached = value.cachedValue === undefined ? { type: "", xml: "" } : formulaCache(value.cachedValue);
  return `<c r="${reference}"${cached.type}${style}><f>${escapeXlsxXml(value.formula.replace(/^=/, ""))}</f>${cached.xml}</c>`;
}

function ensureRow(sheet: PatchSheet, rowNumber: number): PatchRow {
  const existing = sheet.rows.get(rowNumber);
  if (existing) return existing;
  const row = { row: rowNumber, openingTag: `<row r="${rowNumber}">`, residualXml: "", cells: new Map<number, string>() };
  sheet.rows.set(rowNumber, row);
  return row;
}

function setCells(sheet: PatchSheet, startCell: string, values: XlsxCellValue[][]): void {
  const start = parseCellReference(startCell);
  values.forEach((rowValues, rowOffset) => {
    const rowNumber = start.row + rowOffset;
    const row = ensureRow(sheet, rowNumber);
    rowValues.forEach((value, colOffset) => {
      const col = start.col + colOffset;
      const reference = cellReference(col, rowNumber);
      const xml = patchedCellXml(reference, value, row.cells.get(col));
      if (xml) row.cells.set(col, xml);
      else row.cells.delete(col);
    });
  });
}

function clearRange(sheet: PatchSheet, reference: string): void {
  const range = parseRangeReference(reference);
  for (const [rowNumber, row] of sheet.rows) {
    if (rowNumber < range.startRow || rowNumber > range.endRow) continue;
    for (const col of row.cells.keys()) {
      if (col < range.startCol || col > range.endCol) continue;
      const reference = cellReference(col, rowNumber);
      const cleared = clearedCellXml(reference, row.cells.get(col));
      if (cleared) row.cells.set(col, cleared);
      else row.cells.delete(col);
    }
  }
}

function serializeSheet(sheet: PatchSheet): string {
  const rows = Array.from(sheet.rows.values())
    .filter((row) => row.cells.size > 0 || row.residualXml.trim())
    .sort((a, b) => a.row - b.row)
    .map((row) => {
      let opening = replaceXlsxAttribute(row.openingTag, "r", String(row.row));
      if (opening.endsWith("/>")) opening = `${opening.slice(0, -2)}>`;
      const cells = Array.from(row.cells.entries())
        .sort(([left], [right]) => left - right)
        .map(([, xml]) => xml)
        .join("");
      return `${opening}${cells}${row.residualXml}</row>`;
    });
  const populated = Array.from(sheet.rows.values()).flatMap((row) =>
    Array.from(row.cells.keys(), (col) => ({ col, row: row.row })));
  const dimension = populated.length === 0 ? "A1:A1" : formatRangeReference({
    startCol: Math.min(...populated.map((cell) => cell.col)),
    startRow: Math.min(...populated.map((cell) => cell.row)),
    endCol: Math.max(...populated.map((cell) => cell.col)),
    endRow: Math.max(...populated.map((cell) => cell.row)),
  });
  let xml = sheet.xml.replace(
    /<sheetData(?:\s[^>]*)?>[\s\S]*?<\/sheetData>/,
    `<sheetData>${rows.join("")}</sheetData>`,
  );
  if (/<dimension\b[^>]*\/>/.test(xml)) {
    xml = xml.replace(/<dimension\b[^>]*\/>/, `<dimension ref="${dimension}"/>`);
  } else {
    xml = xml.replace(/<worksheet\b[^>]*>/, (opening) => `${opening}<dimension ref="${dimension}"/>`);
  }
  return xml;
}

function ensureCalculation(xml: string): string {
  const calc = `<calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>`;
  if (/<calcPr\b[^>]*\/?>(?:<\/calcPr>)?/.test(xml)) {
    return xml.replace(/<calcPr\b[^>]*\/?>(?:<\/calcPr>)?/, calc);
  }
  return xml.replace("</workbook>", `${calc}</workbook>`);
}

function replaceSheetReferenceText(value: string, oldName: string, newName: string): string {
  const escapedOld = oldName.replace(/'/g, "''").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const unquotedOld = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quotedNew = `'${newName.replace(/'/g, "''")}'!`;
  return value
    .replace(new RegExp(`(^|[^\\]])'${escapedOld}'!`, "gi"), `$1${quotedNew}`)
    .replace(new RegExp(`(^|[^A-Za-z0-9_.'\\]])${unquotedOld}!`, "gi"), `$1${quotedNew}`);
}

function replaceFormulaReferences(xml: string, oldName: string, newName: string): string {
  return xml.replace(
    /<((?:[A-Za-z]+:)?f|formula1|formula2|formula|definedName)(\b[^>]*)>([\s\S]*?)<\/\1>/g,
    (element, tag: string, attributes: string, body: string) => {
      const updated = replaceSheetReferenceText(unescapeXlsxXml(body), oldName, newName);
      return updated === unescapeXlsxXml(body)
        ? element
        : `<${tag}${attributes}>${escapeXlsxXml(updated)}</${tag}>`;
    },
  );
}

export async function patchXlsxBlob(
  data: ArrayBuffer,
  operations: XlsxPatchOperation[],
): Promise<Blob> {
  const zip = await JSZip.loadAsync(data);
  let workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  if (!workbookXml) throw new Error("Workbook metadata is missing.");
  const relationships = parseXlsxRelationships(
    await zip.file("xl/_rels/workbook.xml.rels")?.async("string"),
  );
  const sheetPaths = new Map<string, string>();
  for (const sheet of parseXlsxWorkbook(workbookXml).sheets) {
    const target = relationships.get(sheet.relationshipId);
    if (target) sheetPaths.set(sheet.name.toLocaleLowerCase(), resolveXlsxRelationshipPath(target));
  }
  const sheetNames = parseXlsxWorkbook(workbookXml).sheets.map((sheet) => sheet.name);
  operations = normalizeXlsxPatchFormulaReferences(operations, sheetNames);
  const loaded = new Map<string, PatchSheet>();
  const renamedSheets: Array<{ oldName: string; newName: string }> = [];
  const loadSheet = async (name: string): Promise<PatchSheet> => {
    const key = name.toLocaleLowerCase();
    const existing = loaded.get(key);
    if (existing) return existing;
    const path = sheetPaths.get(key);
    if (!path) throw new Error(`Worksheet "${name}" was not found.`);
    const xml = await zip.file(path)?.async("string");
    if (!xml) throw new Error(`Worksheet XML for "${name}" is missing.`);
    const sheet = { path, xml, rows: parsePatchRows(xml) };
    loaded.set(key, sheet);
    return sheet;
  };
  for (const operation of operations) {
    if (operation.type === "renameSheet") {
      const oldKey = operation.sheet.toLocaleLowerCase();
      const newKey = operation.newName.toLocaleLowerCase();
      if (oldKey !== newKey && sheetPaths.has(newKey)) {
        throw new Error(`Worksheet "${operation.newName}" already exists.`);
      }
      const sheetElement: ParsedWorkbookSheet | undefined = parseXlsxWorkbook(workbookXml).sheets.find(
        (sheet) => sheet.name.toLocaleLowerCase() === operation.sheet.toLocaleLowerCase(),
      );
      if (!sheetElement) throw new Error(`Worksheet "${operation.sheet}" was not found.`);
      const sheetXmlElement: string | undefined = getXlsxElements(workbookXml, "sheet").find((element) =>
        getXlsxAttribute(element, "r:id") === sheetElement.relationshipId);
      if (!sheetXmlElement) throw new Error(`Worksheet metadata for "${operation.sheet}" is missing.`);
      workbookXml = workbookXml.replace(
        sheetXmlElement,
        (element: string): string => replaceXlsxAttribute(element, "name", operation.newName),
      );
      const path = sheetPaths.get(oldKey);
      if (path) {
        sheetPaths.delete(oldKey);
        sheetPaths.set(newKey, path);
        const state = loaded.get(oldKey);
        if (state) {
          loaded.delete(oldKey);
          loaded.set(newKey, state);
        }
      }
      renamedSheets.push({ oldName: operation.sheet, newName: operation.newName });
      continue;
    }
    const sheet = await loadSheet(operation.sheet);
    if (operation.type === "setCells") setCells(sheet, operation.startCell, operation.rows);
    else if (operation.type === "clearRange") clearRange(sheet, operation.range);
    else {
      const maxRow = Math.max(0, ...sheet.rows.keys());
      setCells(sheet, cellReference(operation.startColumn ?? 0, maxRow + 1), operation.rows);
    }
  }
  for (const sheet of loaded.values()) zip.file(sheet.path, serializeSheet(sheet));
  for (const rename of renamedSheets) {
    workbookXml = replaceFormulaReferences(workbookXml, rename.oldName, rename.newName);
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir || !path.endsWith(".xml") || path === "xl/workbook.xml") continue;
      const xml = await entry.async("string");
      const updated = replaceFormulaReferences(xml, rename.oldName, rename.newName);
      if (updated !== xml) zip.file(path, updated);
    }
  }
  zip.file("xl/workbook.xml", ensureCalculation(workbookXml));
  zip.remove("xl/calcChain.xml");
  const relationshipXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (relationshipXml) {
    zip.file(
      "xl/_rels/workbook.xml.rels",
      relationshipXml.replace(/<Relationship\b[^>]*relationships\/calcChain[^>]*\/>/g, ""),
    );
  }
  const contentTypesXml = await zip.file("[Content_Types].xml")?.async("string");
  if (contentTypesXml) {
    zip.file(
      "[Content_Types].xml",
      contentTypesXml.replace(/<Override\b[^>]*PartName=["']\/xl\/calcChain\.xml["'][^>]*\/>/g, ""),
    );
  }
  const bytes = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  return new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
