import JSZip from "jszip";
import {
  parseXlsxRelationships,
  parseXlsxWorkbook,
  resolveXlsxRelationshipPath,
} from "./xlsx_reader_parsing";

const FORMULA_ERROR = /#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!|SPILL!|CALC!|FIELD!|BLOCKED!|UNKNOWN!|CONNECT!|BUSY!)/g;

export interface XlsxPackageValidation {
  sheetCount: number;
  formulaCount: number;
  formulaErrors: string[];
  recalculatesOnOpen: boolean;
}

export async function validateXlsxPackage(blob: Blob): Promise<XlsxPackageValidation> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  const contentTypes = await zip.file("[Content_Types].xml")?.async("string");
  const packageRelationships = await zip.file("_rels/.rels")?.async("string");
  if (!workbookXml || !contentTypes || !packageRelationships) {
    throw new Error("Generated workbook is missing required OOXML package parts.");
  }
  const workbook = parseXlsxWorkbook(workbookXml);
  if (workbook.sheets.length === 0) throw new Error("Generated workbook contains no worksheets.");
  const seen = new Set<string>();
  for (const sheet of workbook.sheets) {
    const key = sheet.name.toLocaleLowerCase();
    if (seen.has(key)) throw new Error(`Generated workbook contains duplicate worksheet "${sheet.name}".`);
    seen.add(key);
  }
  const relationships = parseXlsxRelationships(
    await zip.file("xl/_rels/workbook.xml.rels")?.async("string"),
  );
  let formulaCount = 0;
  const formulaErrors: string[] = [];
  for (const sheet of workbook.sheets) {
    const target = relationships.get(sheet.relationshipId);
    if (!target) throw new Error(`Worksheet relationship for "${sheet.name}" is missing.`);
    const path = resolveXlsxRelationshipPath(target);
    const xml = await zip.file(path)?.async("string");
    if (!xml) throw new Error(`Worksheet part for "${sheet.name}" is missing.`);
    formulaCount += xml.match(/<f(?:\s[^>]*)?>/g)?.length ?? 0;
    for (const match of xml.matchAll(FORMULA_ERROR)) {
      formulaErrors.push(`${sheet.name}: ${match[0]}`);
      if (formulaErrors.length >= 100) break;
    }
  }
  return {
    sheetCount: workbook.sheets.length,
    formulaCount,
    formulaErrors,
    recalculatesOnOpen: /<calcPr\b[^>]*(?:fullCalcOnLoad=["']1["']|forceFullCalc=["']1["'])/.test(workbookXml),
  };
}
