export const xlsxSheetsProperty = {
  type: "array",
  description: "One or more complete worksheets to build.",
  items: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Worksheet tab name (max 31 chars; unsupported Excel characters are replaced).",
      },
      headers: {
        type: "array",
        description: "Column headers for the first row.",
        items: { type: "string" },
      },
      rows: {
        type: "array",
        description:
          "Data rows. Use JSON numbers for numeric cells, strings for text, booleans, null, " +
          "or formula strings beginning with '='. Numeric-looking strings remain text. " +
          "Single-quote worksheet names in cross-sheet formulas, including names without spaces. " +
          "Typed cells are supported: {type:'text',value:'00123'}, {type:'date',value:'2026-07-20'}, " +
          "and {type:'formula',formula:'SUM(A2:A10)',cachedValue:42}.",
        items: { type: "array", items: {} },
      },
      columnWidths: {
        type: "array",
        description: "Column widths in character units. Must match the number of headers.",
        items: { type: "number" },
      },
      rowHeights: {
        type: "array",
        description: "Optional row heights in points.",
        items: {
          type: "object",
          properties: { row: { type: "number" }, height: { type: "number" } },
          required: ["row", "height"],
        },
      },
      cellStyles: {
        type: "array",
        description: "Compositional cell style overrides for A1 ranges.",
        items: {
          type: "object",
          properties: {
            range: { type: "string", description: "A1 range such as B2:B100." },
            bold: { type: "boolean" },
            fontColor: { type: "string", description: "Six-digit RGB hex color." },
            bgColor: { type: "string", description: "Six-digit RGB hex color." },
            borderStyle: { type: "string", description: "thin, medium, or thick." },
            numberFormat: { type: "string", description: "Excel number format string." },
            horizontalAlignment: { type: "string", description: "left, center, or right." },
            verticalAlignment: { type: "string", description: "top, center, or bottom." },
            wrapText: { type: "boolean" },
          },
          required: ["range"],
        },
      },
      columnFormats: {
        type: "array",
        description: "Number formats for complete data columns; cellStyles take precedence.",
        items: {
          type: "object",
          properties: {
            column: { type: "number", description: "Zero-based column index." },
            format: { type: "string", description: "Excel number format string." },
          },
          required: ["column", "format"],
        },
      },
      mergedCells: {
        type: "array",
        description: "Merged A1 ranges. Use sparingly because merged cells hinder sorting and filtering.",
        items: { type: "string" },
      },
      autoFilter: {
        type: "string",
        description: "Autofilter A1 range such as A1:F200.",
      },
      freezeRows: {
        type: "number",
        description: "Number of top rows to freeze. Defaults to one header row.",
      },
      freezeColumns: {
        type: "number",
        description: "Number of left columns to freeze. Defaults to zero.",
      },
      conditionalFormats: {
        type: "array",
        description: "Cell-value conditional formatting rules; provide a font or background color.",
        items: {
          type: "object",
          properties: {
            range: { type: "string", description: "A1 range such as D2:D100." },
            operator: {
              type: "string",
              description: "greaterThan, lessThan, equal, notEqual, or between.",
            },
            formula: { type: "string", description: "First comparison formula or literal." },
            formula2: { type: "string", description: "Required for between." },
            fontColor: { type: "string", description: "Six-digit RGB hex color." },
            bgColor: { type: "string", description: "Six-digit RGB hex color." },
          },
          required: ["range", "operator", "formula"],
        },
      },
      dataValidations: {
        type: "array",
        description: "Input constraints such as dropdown lists, numeric bounds, and dates.",
        items: {
          type: "object",
          properties: {
            range: { type: "string", description: "A1 range such as C2:C100." },
            type: { type: "string", description: "list, whole, decimal, date, or textLength." },
            formula1: {
              type: "string",
              description: "First constraint. For a literal list use an Excel string such as \"Open,Closed\".",
            },
            formula2: { type: "string", description: "Second bound for between/notBetween." },
            operator: {
              type: "string",
              description: "Required except for list rules: between, notBetween, equal, notEqual, greaterThan, or lessThan.",
            },
            allowBlank: { type: "boolean" },
            prompt: { type: "string" },
            error: { type: "string" },
          },
          required: ["range", "type", "formula1"],
        },
      },
    },
    required: ["name", "headers", "rows"],
  },
};

export const xlsxNamedRangesProperty = {
  type: "array",
  description: "Workbook named ranges, including the sheet name in each range.",
  items: {
    type: "object",
    properties: {
      name: { type: "string", description: "Range name such as Revenue." },
      range: { type: "string", description: "Range such as Summary!B2:B100." },
    },
    required: ["name", "range"],
  },
};
