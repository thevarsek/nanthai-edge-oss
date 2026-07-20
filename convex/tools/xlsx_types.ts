export type XlsxPrimitive = string | number | boolean | null;

export interface XlsxTextCell {
  type: "text";
  value: string;
}

export interface XlsxDateCell {
  type: "date";
  value: string;
}

export interface XlsxFormulaCell {
  type: "formula";
  formula: string;
  cachedValue?: string | number | boolean;
}

export type XlsxCellValue = XlsxPrimitive | XlsxTextCell | XlsxDateCell | XlsxFormulaCell;

export interface XlsxCellStyle {
  range: string;
  bold?: boolean;
  fontColor?: string;
  bgColor?: string;
  borderStyle?: "thin" | "medium" | "thick";
  numberFormat?: string;
  horizontalAlignment?: "left" | "center" | "right";
  verticalAlignment?: "top" | "center" | "bottom";
  wrapText?: boolean;
}

export interface XlsxColumnFormat {
  column: number;
  format: string;
}

export interface XlsxConditionalFormat {
  range: string;
  operator: "greaterThan" | "lessThan" | "equal" | "notEqual" | "between";
  formula: string;
  formula2?: string;
  fontColor?: string;
  bgColor?: string;
}

export interface XlsxDataValidation {
  range: string;
  type: "list" | "whole" | "decimal" | "date" | "textLength";
  formula1: string;
  formula2?: string;
  operator?: "between" | "notBetween" | "equal" | "notEqual" | "greaterThan" | "lessThan";
  allowBlank?: boolean;
  prompt?: string;
  error?: string;
}

export interface XlsxSheet {
  name: string;
  headers: string[];
  rows: XlsxCellValue[][];
  freezeHeader?: boolean;
  freezeRows?: number;
  freezeColumns?: number;
  columnWidths?: number[];
  rowHeights?: Array<{ row: number; height: number }>;
  cellStyles?: XlsxCellStyle[];
  columnFormats?: XlsxColumnFormat[];
  mergedCells?: string[];
  autoFilter?: string;
  conditionalFormats?: XlsxConditionalFormat[];
  dataValidations?: XlsxDataValidation[];
}

export interface XlsxOptions {
  title: string;
  sheets: XlsxSheet[];
  namedRanges?: Array<{ name: string; range: string }>;
}

export interface XlsxPatchSetCellsOperation {
  type: "setCells";
  sheet: string;
  startCell: string;
  rows: XlsxCellValue[][];
}

export interface XlsxPatchClearRangeOperation {
  type: "clearRange";
  sheet: string;
  range: string;
}

export interface XlsxPatchAppendRowsOperation {
  type: "appendRows";
  sheet: string;
  rows: XlsxCellValue[][];
  startColumn?: number;
}

export interface XlsxPatchRenameSheetOperation {
  type: "renameSheet";
  sheet: string;
  newName: string;
}

export type XlsxPatchOperation =
  | XlsxPatchSetCellsOperation
  | XlsxPatchClearRangeOperation
  | XlsxPatchAppendRowsOperation
  | XlsxPatchRenameSheetOperation;
