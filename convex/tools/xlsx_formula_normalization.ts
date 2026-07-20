import type { XlsxCellValue, XlsxOptions, XlsxPatchOperation } from "./xlsx_types";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quoteSheetName(value: string): string {
  return `'${value.replace(/'/g, "''")}'!`;
}

function replaceOutsideStringLiterals(value: string, replace: (segment: string) => string): string {
  let result = "";
  let segmentStart = 0;
  let index = 0;
  while (index < value.length) {
    if (value[index] !== '"') {
      index += 1;
      continue;
    }
    result += replace(value.slice(segmentStart, index));
    const literalStart = index;
    index += 1;
    while (index < value.length) {
      if (value[index] !== '"') {
        index += 1;
        continue;
      }
      if (value[index + 1] === '"') {
        index += 2;
        continue;
      }
      index += 1;
      break;
    }
    result += value.slice(literalStart, index);
    segmentStart = index;
  }
  return result + replace(value.slice(segmentStart));
}

export function createXlsxFormulaNormalizer(sheetNames: string[]): (value: string) => string {
  const names = [...new Set(sheetNames)].sort((left, right) => right.length - left.length);
  if (names.length === 0) return (value) => value;
  const canonical = new Map(names.map((name) => [name.toLocaleLowerCase(), name]));
  const alternatives = names.map(escapeRegExp).join("|");
  const doubleQuoted = new RegExp(`"(${alternatives})"!`, "gi");
  const threeDimensional = new RegExp(`(^|[^\\]A-Za-z0-9_.'\\\\])(${alternatives}):(${alternatives})!`, "gi");
  const unquoted = new RegExp(`(^|[^\\]A-Za-z0-9_.'\\\\])(${alternatives})!`, "gi");
  const replacement = (_match: string, prefix: string, name: string): string =>
    `${prefix}${quoteSheetName(canonical.get(name.toLocaleLowerCase()) ?? name)}`;
  return (value) => {
    const repairedQuotes = value.replace(doubleQuoted, (_match, name: string) =>
      quoteSheetName(canonical.get(name.toLocaleLowerCase()) ?? name));
    return replaceOutsideStringLiterals(repairedQuotes, (segment) => segment
      .replace(threeDimensional, (_match, prefix: string, first: string, last: string) => {
        const firstName = canonical.get(first.toLocaleLowerCase()) ?? first;
        const lastName = canonical.get(last.toLocaleLowerCase()) ?? last;
        return `${prefix}${quoteSheetName(`${firstName}:${lastName}`)}`;
      })
      .replace(unquoted, replacement));
  };
}

function normalizeCell(value: XlsxCellValue, normalize: (formula: string) => string): XlsxCellValue {
  if (typeof value === "string" && value.startsWith("=")) return normalize(value);
  if (typeof value === "object" && value !== null && value.type === "formula") {
    const formula = normalize(value.formula);
    return formula === value.formula ? value : { ...value, formula };
  }
  return value;
}

function normalizeRows(rows: XlsxCellValue[][], normalize: (formula: string) => string): XlsxCellValue[][] {
  let result: XlsxCellValue[][] | undefined;
  rows.forEach((row, rowIndex) => {
    let normalizedRow: XlsxCellValue[] | undefined;
    row.forEach((value, columnIndex) => {
      const normalized = normalizeCell(value, normalize);
      if (normalized === value) return;
      normalizedRow ??= [...row];
      normalizedRow[columnIndex] = normalized;
    });
    if (!normalizedRow) return;
    result ??= [...rows];
    result[rowIndex] = normalizedRow;
  });
  return result ?? rows;
}

export function normalizeXlsxFormulaReferences(options: XlsxOptions): XlsxOptions {
  const normalize = createXlsxFormulaNormalizer(options.sheets.map((sheet) => sheet.name));
  return {
    ...options,
    sheets: options.sheets.map((sheet) => ({
      ...sheet,
      rows: normalizeRows(sheet.rows, normalize),
      conditionalFormats: sheet.conditionalFormats?.map((rule) => ({
        ...rule,
        formula: normalize(rule.formula),
        formula2: rule.formula2 === undefined ? undefined : normalize(rule.formula2),
      })),
      dataValidations: sheet.dataValidations?.map((rule) => ({
        ...rule,
        formula1: normalize(rule.formula1),
        formula2: rule.formula2 === undefined ? undefined : normalize(rule.formula2),
      })),
    })),
    namedRanges: options.namedRanges?.map((range) => ({ ...range, range: normalize(range.range) })),
  };
}

export function normalizeXlsxPatchFormulaReferences(
  operations: XlsxPatchOperation[],
  sheetNames: string[],
): XlsxPatchOperation[] {
  const renamed = operations.flatMap((operation) =>
    operation.type === "renameSheet" ? [operation.newName] : []);
  const normalize = createXlsxFormulaNormalizer([...sheetNames, ...renamed]);
  return operations.map((operation) =>
    operation.type === "setCells" || operation.type === "appendRows"
      ? { ...operation, rows: normalizeRows(operation.rows, normalize) }
      : operation);
}
