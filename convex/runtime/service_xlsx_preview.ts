"use node";

import type { Sandbox } from "@vercel/sandbox";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { ToolExecutionContext } from "../tools/registry";
import { getOrCreatePersistentRuntime } from "./service_vm";

const XLSX_PREVIEW_TIMEOUT_MS = 5 * 60 * 1000;

interface PreviewRuntimeResult {
  pdfPath: string;
  sheetCount: number;
  formulaCount: number;
  formulaErrors: string[];
  truncated: boolean;
}

async function installPreviewPackages(sandbox: Sandbox): Promise<void> {
  const available = await sandbox.runCommand("python3", ["-c", "import openpyxl, reportlab"], {
    signal: AbortSignal.timeout(XLSX_PREVIEW_TIMEOUT_MS),
  });
  if (available.exitCode === 0) return;
  const installed = await sandbox.runCommand("pip", ["install", "-q", "openpyxl", "reportlab"], {
    signal: AbortSignal.timeout(XLSX_PREVIEW_TIMEOUT_MS),
  });
  if (installed.exitCode !== 0) {
    throw new ConvexError({
      code: "INTERNAL_ERROR" as const,
      message: `Workbook preview dependencies could not be installed. ${await installed.stderr()}`.trim(),
    });
  }
}

function previewPython(): string {
  return `
import html, json, sys
from openpyxl import load_workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

payload = json.load(open(sys.argv[1], encoding="utf-8"))
source_path = payload["sourcePath"]
pdf_path = payload["pdfPath"]
result_path = payload["resultPath"]
formula_book = load_workbook(source_path, read_only=True, data_only=False)
value_book = load_workbook(source_path, read_only=True, data_only=True)
styles = getSampleStyleSheet()
story = [Paragraph(html.escape(payload["title"]), styles["Title"]), Spacer(1, 4 * mm)]
formula_count = 0
formula_errors = []
truncated = False
error_values = {"#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!"}

for sheet_index, formula_sheet in enumerate(formula_book.worksheets):
    value_sheet = value_book[formula_sheet.title]
    story.append(Paragraph(html.escape(formula_sheet.title), styles["Heading2"]))
    max_rows = min(formula_sheet.max_row or 1, 100)
    max_cols = min(formula_sheet.max_column or 1, 16)
    if (formula_sheet.max_row > max_rows or formula_sheet.max_column > max_cols:
        truncated = True
    data = []
    for row in range(1, max_rows + 1):
        rendered = []
        for col in range(1, max_cols + 1):
            formula_value = formula_sheet.cell(row=row, column=col).value
            cached_value = value_sheet.cell(row=row, column=col).value
            if isinstance(formula_value, str) and formula_value.startswith("="):
                formula_count += 1
            visible = cached_value if cached_value is not None else formula_value
            if isinstance(visible, str) and visible in error_values:
                formula_errors.append(f"{formula_sheet.title}!{formula_sheet.cell(row=row, column=col).coordinate}: {visible}")
            text = "" if visible is None else str(visible)
            rendered.append(text[:60] + ("…" if len(text) > 60 else ""))
        data.append(rendered)
    if not data:
        data = [["(empty sheet)"]]
    available_width = landscape(A4)[0] - 24 * mm
    table = Table(data, repeatRows=1, colWidths=[available_width / max(1, max_cols)] * max(1, max_cols))
    commands = [
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("D1D5DB")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("1F4E78")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 6.5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]
    table.setStyle(TableStyle(commands))
    story.append(table)
    if sheet_index < len(formula_book.worksheets) - 1:
        story.append(PageBreak())

document = SimpleDocTemplate(
    pdf_path,
    pagesize=landscape(A4),
    title=payload["title"],
    leftMargin=12 * mm,
    rightMargin=12 * mm,
    topMargin=12 * mm,
    bottomMargin=12 * mm,
)
document.build(story)
with open(result_path, "w", encoding="utf-8") as result_file:
    json.dump({
        "pdfPath": pdf_path,
        "sheetCount": len(formula_book.worksheets),
        "formulaCount": formula_count,
        "formulaErrors": formula_errors[:100],
        "truncated": truncated,
    }, result_file)
`.trim();
}

export async function createXlsxPreview(
  toolCtx: ToolExecutionContext,
  args: { storageId: Id<"_storage">; title: string },
): Promise<{
  preview: {
    storageId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    downloadUrl: string | null;
  };
  validation: Omit<PreviewRuntimeResult, "pdfPath"> & { engine: "openpyxl" };
}> {
  const runtime = await getOrCreatePersistentRuntime(toolCtx, "python", XLSX_PREVIEW_TIMEOUT_MS);
  const blob = await toolCtx.ctx.storage.get(args.storageId);
  if (!blob) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Workbook bytes were not found." });
  const safeBase = args.title.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "spreadsheet";
  const runKey = String(args.storageId).replace(/[^A-Za-z0-9]+/g, "").slice(-12) || "workbook";
  const sourcePath = `${runtime.workspace.inputs}/${safeBase}_${runKey}.xlsx`;
  const pdfPath = `${runtime.workspace.outputs}/${safeBase}_${runKey}_preview.pdf`;
  const scriptPath = `${runtime.workspace.root}/xlsx_preview_${runKey}.py`;
  const inputPath = `${runtime.workspace.root}/xlsx_preview_input_${runKey}.json`;
  const resultPath = `${runtime.workspace.outputs}/${safeBase}_${runKey}_preview.json`;
  await installPreviewPackages(runtime.sandbox);
  await runtime.sandbox.writeFiles([
    { path: sourcePath, content: new Uint8Array(await blob.arrayBuffer()) },
    { path: scriptPath, content: previewPython() },
    {
      path: inputPath,
      content: JSON.stringify({ sourcePath, pdfPath, resultPath, title: args.title }),
    },
  ]);
  const process = await runtime.sandbox.runCommand("python3", [scriptPath, inputPath], {
    signal: AbortSignal.timeout(XLSX_PREVIEW_TIMEOUT_MS),
  });
  if (process.exitCode !== 0) {
    const stderr = await process.stderr();
    throw new ConvexError({
      code: "INTERNAL_ERROR" as const,
      message: `Workbook validation failed.${stderr ? ` ${stderr}` : ""}`,
    });
  }
  const resultBuffer = await runtime.sandbox.readFileToBuffer({ path: resultPath });
  const pdfBuffer = await runtime.sandbox.readFileToBuffer({ path: pdfPath });
  if (!resultBuffer || !pdfBuffer) {
    throw new ConvexError({ code: "INTERNAL_ERROR" as const, message: "Workbook preview was not produced." });
  }
  const result = JSON.parse(Buffer.from(resultBuffer).toString("utf8")) as PreviewRuntimeResult;
  const pdfBytes = new Uint8Array(pdfBuffer);
  const previewStorageId = await toolCtx.ctx.storage.store(new Blob([pdfBytes], { type: "application/pdf" }));
  return {
    preview: {
      storageId: previewStorageId,
      filename: `${safeBase}_preview.pdf`,
      mimeType: "application/pdf",
      sizeBytes: pdfBytes.byteLength,
      downloadUrl: await toolCtx.ctx.storage.getUrl(previewStorageId),
    },
    validation: {
      engine: "openpyxl",
      sheetCount: result.sheetCount,
      formulaCount: result.formulaCount,
      formulaErrors: result.formulaErrors,
      truncated: result.truncated,
    },
  };
}
