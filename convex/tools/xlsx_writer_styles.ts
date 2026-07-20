import { escapeXlsxXml } from "./xlsx_xml";

export interface XlsxStyleSpec {
  bold: boolean;
  fontColor: string;
  bgColor: string;
  borderStyle: string;
  numFmtId: number;
  horizontalAlignment: string;
  verticalAlignment: string;
  wrapText: boolean;
}

interface RegisteredStyle {
  fontId: number;
  fillId: number;
  borderId: number;
  numFmtId: number;
  horizontalAlignment: string;
  verticalAlignment: string;
  wrapText: boolean;
}

export const DEFAULT_XLSX_STYLE: XlsxStyleSpec = {
  bold: false,
  fontColor: "000000",
  bgColor: "",
  borderStyle: "",
  numFmtId: 0,
  horizontalAlignment: "",
  verticalAlignment: "",
  wrapText: false,
};

export const HEADER_XLSX_STYLE: XlsxStyleSpec = {
  ...DEFAULT_XLSX_STYLE,
  bold: true,
  bgColor: "D9E2F3",
  borderStyle: "thin",
  verticalAlignment: "center",
};

export class XlsxStyleRegistry {
  private nextNumFmtId = 164;
  private readonly numFmtMap = new Map<string, number>();
  private readonly numFmtList: Array<{ id: number; formatCode: string }> = [];
  private readonly fontKeys = ["normal|000000", "bold|000000"];
  private readonly fontXml = [
    `<font><sz val="11"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="11"/><name val="Calibri"/></font>`,
  ];
  private readonly fillKeys = ["none", "gray125", "D9E2F3"];
  private readonly fillXml = [
    `<fill><patternFill patternType="none"/></fill>`,
    `<fill><patternFill patternType="gray125"/></fill>`,
    `<fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/></patternFill></fill>`,
  ];
  private readonly borderKeys = ["none", "thin"];
  private readonly borderXml = [
    `<border/>`,
    this.borderXmlFor("thin"),
  ];
  private readonly styleKeys: string[] = [];
  private readonly styles: RegisteredStyle[] = [];
  private readonly differentialKeys: string[] = [];
  private readonly differentialXml: string[] = [];

  constructor() {
    this.getStyleId(DEFAULT_XLSX_STYLE);
    this.getStyleId(HEADER_XLSX_STYLE);
  }

  getNumFmtId(format: string): number {
    const builtIn: Record<string, number> = {
      General: 0, "0": 1, "0.00": 2, "#,##0": 3, "#,##0.00": 4,
      "0%": 9, "0.00%": 10, "mm-dd-yy": 14, "d-mmm-yy": 15,
      "d-mmm": 16, "mmm-yy": 17, "h:mm AM/PM": 18, "h:mm:ss AM/PM": 19,
      "h:mm": 20, "h:mm:ss": 21, "m/d/yy h:mm": 22,
    };
    if (builtIn[format] !== undefined) return builtIn[format];
    const existing = this.numFmtMap.get(format);
    if (existing !== undefined) return existing;
    const id = this.nextNumFmtId++;
    this.numFmtMap.set(format, id);
    this.numFmtList.push({ id, formatCode: format });
    return id;
  }

  getStyleId(spec: XlsxStyleSpec): number {
    const fontId = this.fontId(spec.bold, spec.fontColor);
    const fillId = this.fillId(spec.bgColor);
    const borderId = this.borderId(spec.borderStyle);
    const key = [
      fontId, fillId, borderId, spec.numFmtId,
      spec.horizontalAlignment, spec.verticalAlignment, spec.wrapText ? 1 : 0,
    ].join("|");
    const existing = this.styleKeys.indexOf(key);
    if (existing >= 0) return existing;
    this.styleKeys.push(key);
    this.styles.push({
      fontId,
      fillId,
      borderId,
      numFmtId: spec.numFmtId,
      horizontalAlignment: spec.horizontalAlignment,
      verticalAlignment: spec.verticalAlignment,
      wrapText: spec.wrapText,
    });
    return this.styles.length - 1;
  }

  getDifferentialStyleId(fontColor = "", bgColor = ""): number {
    const key = `${fontColor}|${bgColor}`;
    const existing = this.differentialKeys.indexOf(key);
    if (existing >= 0) return existing;
    const font = fontColor ? `<font><color rgb="FF${fontColor}"/></font>` : "";
    const fill = bgColor
      ? `<fill><patternFill patternType="solid"><fgColor rgb="FF${bgColor}"/><bgColor indexed="64"/></patternFill></fill>`
      : "";
    this.differentialKeys.push(key);
    this.differentialXml.push(`<dxf>${font}${fill}</dxf>`);
    return this.differentialXml.length - 1;
  }

  private fontId(bold: boolean, color: string): number {
    const key = `${bold ? "bold" : "normal"}|${color}`;
    const existing = this.fontKeys.indexOf(key);
    if (existing >= 0) return existing;
    this.fontKeys.push(key);
    this.fontXml.push(
      `<font>${bold ? "<b/>" : ""}<sz val="11"/>` +
      `${color === "000000" ? "" : `<color rgb="FF${color}"/>`}<name val="Calibri"/></font>`,
    );
    return this.fontKeys.length - 1;
  }

  private fillId(color: string): number {
    if (!color) return 0;
    const existing = this.fillKeys.indexOf(color);
    if (existing >= 0) return existing;
    this.fillKeys.push(color);
    this.fillXml.push(
      `<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/></patternFill></fill>`,
    );
    return this.fillKeys.length - 1;
  }

  private borderId(style: string): number {
    if (!style) return 0;
    const existing = this.borderKeys.indexOf(style);
    if (existing >= 0) return existing;
    this.borderKeys.push(style);
    this.borderXml.push(this.borderXmlFor(style));
    return this.borderKeys.length - 1;
  }

  private borderXmlFor(style: string): string {
    const side = (name: string) => `<${name} style="${style}"><color auto="1"/></${name}>`;
    return `<border>${side("left")}${side("right")}${side("top")}${side("bottom")}</border>`;
  }

  toXml(): string {
    const numberFormats = this.numFmtList.length === 0 ? "" :
      `<numFmts count="${this.numFmtList.length}">` +
      this.numFmtList.map((format) =>
        `<numFmt numFmtId="${format.id}" formatCode="${escapeXlsxXml(format.formatCode)}"/>`).join("") +
      `</numFmts>`;
    const cellFormats = this.styles.map((style) => {
      const apply = [
        style.fontId > 0 ? `applyFont="1"` : "",
        style.fillId > 0 ? `applyFill="1"` : "",
        style.borderId > 0 ? `applyBorder="1"` : "",
        style.numFmtId > 0 ? `applyNumberFormat="1"` : "",
        style.horizontalAlignment || style.verticalAlignment || style.wrapText ? `applyAlignment="1"` : "",
      ].filter(Boolean).join(" ");
      const alignment = style.horizontalAlignment || style.verticalAlignment || style.wrapText
        ? `<alignment${style.horizontalAlignment ? ` horizontal="${style.horizontalAlignment}"` : ""}` +
          `${style.verticalAlignment ? ` vertical="${style.verticalAlignment}"` : ""}` +
          `${style.wrapText ? ` wrapText="1"` : ""}/>`
        : "";
      return `<xf numFmtId="${style.numFmtId}" fontId="${style.fontId}" fillId="${style.fillId}" ` +
        `borderId="${style.borderId}" xfId="0"${apply ? ` ${apply}` : ""}>${alignment}</xf>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      numberFormats +
      `<fonts count="${this.fontXml.length}">${this.fontXml.join("")}</fonts>` +
      `<fills count="${this.fillXml.length}">${this.fillXml.join("")}</fills>` +
      `<borders count="${this.borderXml.length}">${this.borderXml.join("")}</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${this.styles.length}">${cellFormats}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `<dxfs count="${this.differentialXml.length}">${this.differentialXml.join("")}</dxfs>` +
      `<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>` +
      `</styleSheet>`;
  }
}
