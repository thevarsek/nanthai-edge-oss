export const MAX_XLSX_ROW = 1_048_576;
export const MAX_XLSX_COLUMN = 16_384;

export interface XlsxCellReference {
  col: number;
  row: number;
}

export interface XlsxRangeReference {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

export function columnLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_XLSX_COLUMN) {
    throw new Error(`Column index ${index} is outside Excel's supported range.`);
  }
  let result = "";
  let current = index;
  while (current >= 0) {
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26) - 1;
  }
  return result;
}

export function columnIndex(letters: string): number {
  const normalized = letters.replace(/\$/g, "").toUpperCase();
  if (!/^[A-Z]+$/.test(normalized)) {
    throw new Error(`Invalid Excel column reference: ${letters}`);
  }
  let result = 0;
  for (const character of normalized) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  const index = result - 1;
  if (index >= MAX_XLSX_COLUMN) {
    throw new Error(`Column ${letters} is outside Excel's supported range.`);
  }
  return index;
}

export function cellReference(col: number, row: number): string {
  if (!Number.isInteger(row) || row < 1 || row > MAX_XLSX_ROW) {
    throw new Error(`Row ${row} is outside Excel's supported range.`);
  }
  return `${columnLetter(col)}${row}`;
}

export function parseCellReference(reference: string): XlsxCellReference {
  const match = reference.trim().toUpperCase().match(/^\$?([A-Z]+)\$?(\d+)$/);
  if (!match) throw new Error(`Invalid A1 cell reference: ${reference}`);
  const row = Number(match[2]);
  if (!Number.isInteger(row) || row < 1 || row > MAX_XLSX_ROW) {
    throw new Error(`Row ${match[2]} is outside Excel's supported range.`);
  }
  return { col: columnIndex(match[1]), row };
}

export function parseRangeReference(range: string): XlsxRangeReference {
  const parts = range.trim().split(":");
  if (parts.length < 1 || parts.length > 2) {
    throw new Error(`Invalid A1 range: ${range}`);
  }
  const first = parseCellReference(parts[0]);
  const second = parts.length === 2 ? parseCellReference(parts[1]) : first;
  return {
    startCol: Math.min(first.col, second.col),
    startRow: Math.min(first.row, second.row),
    endCol: Math.max(first.col, second.col),
    endRow: Math.max(first.row, second.row),
  };
}

export function formatRangeReference(range: XlsxRangeReference): string {
  return `${cellReference(range.startCol, range.startRow)}:${cellReference(range.endCol, range.endRow)}`;
}
