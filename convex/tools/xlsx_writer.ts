import JSZip from "jszip";
import type { XlsxOptions } from "./xlsx_types";
import { escapeXlsxXml } from "./xlsx_xml";
import { XlsxSharedStrings, buildXlsxSheetXml } from "./xlsx_writer_sheet";
import { XlsxStyleRegistry } from "./xlsx_writer_styles";

export type {
  XlsxCellStyle,
  XlsxCellValue,
  XlsxColumnFormat,
  XlsxOptions,
  XlsxSheet,
} from "./xlsx_types";

function contentTypes(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ` +
    `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ` +
    `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets +
    `<Override PartName="/xl/styles.xml" ` +
    `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ` +
    `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `<Override PartName="/docProps/core.xml" ` +
    `ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ` +
    `ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
    `</Types>`;
}

function workbookXml(options: XlsxOptions): string {
  const sheets = options.sheets.map((sheet, index) =>
    `<sheet name="${escapeXlsxXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const names = options.namedRanges?.length
    ? `<definedNames>${options.namedRanges.map((range) =>
      `<definedName name="${escapeXlsxXml(range.name)}">${escapeXlsxXml(range.range)}</definedName>`).join("")}</definedNames>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<workbookPr date1904="0"/><bookViews><workbookView activeTab="0"/></bookViews>` +
    `<sheets>${sheets}</sheets>${names}` +
    `<calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>` +
    `</workbook>`;
}

function workbookRelationships(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ` +
    `Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets}` +
    `<Relationship Id="rId${sheetCount + 1}" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${sheetCount + 2}" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`;
}

function packageRelationships(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
    `</Relationships>`;
}

function coreProperties(title: string): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${escapeXlsxXml(title)}</dc:title><dc:creator>NanthAI</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

export async function buildXlsxBlob(options: XlsxOptions): Promise<Blob> {
  const zip = new JSZip();
  const strings = new XlsxSharedStrings();
  const styles = new XlsxStyleRegistry();
  const worksheets = options.sheets.map((sheet) => buildXlsxSheetXml(sheet, strings, styles));
  zip.file("[Content_Types].xml", contentTypes(options.sheets.length));
  zip.file("_rels/.rels", packageRelationships());
  zip.file("xl/workbook.xml", workbookXml(options));
  zip.file("xl/_rels/workbook.xml.rels", workbookRelationships(options.sheets.length));
  zip.file("xl/styles.xml", styles.toXml());
  zip.file("xl/sharedStrings.xml", strings.toXml());
  zip.file("docProps/core.xml", coreProperties(options.title));
  zip.file("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ` +
    `xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    `<Application>NanthAI</Application></Properties>`);
  worksheets.forEach((xml, index) => zip.file(`xl/worksheets/sheet${index + 1}.xml`, xml));
  const bytes = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  return new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
