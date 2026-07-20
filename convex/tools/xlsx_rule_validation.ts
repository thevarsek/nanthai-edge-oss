import { parseRangeReference } from "./xlsx_references";
import type { XlsxSheet } from "./xlsx_types";

const MAX_SHEET_RULES = 1_000;
const HEX_COLOR = /^[0-9A-F]{6}$/;

export function normalizeConditionalFormats(
  raw: unknown,
  location: string,
): NonNullable<XlsxSheet["conditionalFormats"]> | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_SHEET_RULES) {
    throw new Error(`${location} must contain no more than ${MAX_SHEET_RULES} rules.`);
  }
  const operators = new Set(["greaterThan", "lessThan", "equal", "notEqual", "between"]);
  return raw.map((value, index) => {
    const rule = value as Record<string, unknown>;
    const range = String(rule.range ?? "");
    const operator = String(rule.operator ?? "");
    const formula = String(rule.formula ?? "").trim();
    const formula2 = rule.formula2 === undefined ? undefined : String(rule.formula2).trim();
    parseRangeReference(range);
    if (!operators.has(operator) || !formula || formula.length > 8_192 || (formula2?.length ?? 0) > 8_192 ||
        (rule.fontColor === undefined && rule.bgColor === undefined) ||
        (operator === "between" && !formula2)) {
      throw new Error(`${location}[${index}] is invalid.`);
    }
    for (const color of [rule.fontColor, rule.bgColor]) {
      if (color !== undefined && !HEX_COLOR.test(String(color).replace(/^#/, "").toUpperCase())) {
        throw new Error(`${location}[${index}] contains an invalid color.`);
      }
    }
    return {
      range,
      operator: operator as NonNullable<XlsxSheet["conditionalFormats"]>[number]["operator"],
      formula,
      formula2,
      fontColor: rule.fontColor === undefined ? undefined : String(rule.fontColor),
      bgColor: rule.bgColor === undefined ? undefined : String(rule.bgColor),
    };
  });
}

export function normalizeDataValidations(
  raw: unknown,
  location: string,
): NonNullable<XlsxSheet["dataValidations"]> | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_SHEET_RULES) {
    throw new Error(`${location} must contain no more than ${MAX_SHEET_RULES} rules.`);
  }
  const types = new Set(["list", "whole", "decimal", "date", "textLength"]);
  const operators = new Set(["between", "notBetween", "equal", "notEqual", "greaterThan", "lessThan"]);
  return raw.map((value, index) => {
    const rule = value as Record<string, unknown>;
    const range = String(rule.range ?? "");
    const type = String(rule.type ?? "");
    const formula1 = String(rule.formula1 ?? "").trim();
    const formula2 = rule.formula2 === undefined ? undefined : String(rule.formula2).trim();
    const operator = rule.operator === undefined ? undefined : String(rule.operator);
    parseRangeReference(range);
    if (!types.has(type) || !formula1 || formula1.length > 8_192 || (formula2?.length ?? 0) > 8_192 ||
        (operator !== undefined && !operators.has(operator)) ||
        (type === "list" && (operator !== undefined || formula2 !== undefined)) ||
        (type !== "list" && operator === undefined) ||
        ((operator === "between" || operator === "notBetween") && !formula2)) {
      throw new Error(`${location}[${index}] is invalid.`);
    }
    const prompt = rule.prompt === undefined ? undefined : String(rule.prompt);
    const error = rule.error === undefined ? undefined : String(rule.error);
    if ((prompt?.length ?? 0) > 255 || (error?.length ?? 0) > 225) {
      throw new Error(`${location}[${index}] prompt or error text is too long.`);
    }
    return {
      range,
      type: type as NonNullable<XlsxSheet["dataValidations"]>[number]["type"],
      formula1,
      formula2,
      operator: operator as NonNullable<XlsxSheet["dataValidations"]>[number]["operator"],
      allowBlank: typeof rule.allowBlank === "boolean" ? rule.allowBlank : undefined,
      prompt,
      error,
    };
  });
}
