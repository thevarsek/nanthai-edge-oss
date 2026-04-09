import { Id } from "../_generated/dataModel";
import { RecordedToolResult } from "../tools/execute_loop";

const MIME_BY_EXT: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".eml": "message/rfc822",
};

const FILE_PRODUCING_TOOLS = new Set([
  "generate_docx", "edit_docx",
  "generate_pptx", "edit_pptx",
  "generate_xlsx", "edit_xlsx",
  "generate_text_file",
  "generate_eml",
  "workspace_export_file",
  "data_python_exec",
  "data_python_sandbox",
]);

export function extractGeneratedFiles(
  toolResults: RecordedToolResult[],
): Array<{
  storageId: Id<"_storage">;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  toolName: string;
}> {
  const files: Array<{
    storageId: Id<"_storage">;
    filename: string;
    mimeType: string;
    sizeBytes?: number;
    toolName: string;
  }> = [];

  for (const tr of toolResults) {
    if (tr.isError || !FILE_PRODUCING_TOOLS.has(tr.toolName)) continue;
    try {
      const data = JSON.parse(tr.result);
      const candidates = (tr.toolName === "data_python_exec" || tr.toolName === "data_python_sandbox")
        ? Array.isArray(data.exportedFiles) ? data.exportedFiles : []
        : [data];

      for (const candidate of candidates) {
        const sid = candidate.newStorageId ?? candidate.storageId;
        const filename = candidate.filename;
        if (!sid || !filename) continue;
        const extMatch = filename.match(/\.[a-z]+$/i);
        const ext = extMatch ? extMatch[0].toLowerCase() : "";
        files.push({
          storageId: sid as Id<"_storage">,
          filename,
          mimeType: candidate.mimeType ?? MIME_BY_EXT[ext] ?? "application/octet-stream",
          sizeBytes: typeof candidate.sizeBytes === "number" ? candidate.sizeBytes : undefined,
          toolName: typeof candidate.toolName === "string" ? candidate.toolName : tr.toolName,
        });
      }
    } catch {
      // Ignore malformed/truncated tool results.
    }
  }

  return files;
}

export function extractGeneratedCharts(
  toolResults: RecordedToolResult[],
): Array<{
  toolName: string;
  chartType: "line" | "bar" | "scatter" | "pie" | "box" | "png_image";
  title?: string;
  xLabel?: string;
  yLabel?: string;
  xUnit?: string;
  yUnit?: string;
  elements: unknown;
  pngBase64?: string;
}> {
  const charts: Array<{
    toolName: string;
    chartType: "line" | "bar" | "scatter" | "pie" | "box" | "png_image";
    title?: string;
    xLabel?: string;
    yLabel?: string;
    xUnit?: string;
    yUnit?: string;
    elements: unknown;
    pngBase64?: string;
  }> = [];

  for (const tr of toolResults) {
    if (tr.isError || (tr.toolName !== "data_python_exec" && tr.toolName !== "data_python_sandbox")) continue;
    try {
      const data = JSON.parse(tr.result);
      const candidates = Array.isArray(data.chartsCreated) ? data.chartsCreated : [];
      for (const candidate of candidates) {
        if (
          !candidate ||
          typeof candidate.chartType !== "string" ||
          !Array.isArray(candidate.elements)
        ) {
          continue;
        }
        if (!["line", "bar", "scatter", "pie", "box", "png_image"].includes(candidate.chartType)) {
          continue;
        }
        charts.push({
          toolName: typeof candidate.toolName === "string" ? candidate.toolName : tr.toolName,
          chartType: candidate.chartType,
          title: typeof candidate.title === "string" ? candidate.title : undefined,
          xLabel: typeof candidate.xLabel === "string" ? candidate.xLabel : undefined,
          yLabel: typeof candidate.yLabel === "string" ? candidate.yLabel : undefined,
          xUnit: typeof candidate.xUnit === "string" ? candidate.xUnit : undefined,
          yUnit: typeof candidate.yUnit === "string" ? candidate.yUnit : undefined,
          elements: candidate.elements,
          pngBase64: typeof candidate.pngBase64 === "string" ? candidate.pngBase64 : undefined,
        });
      }
    } catch {
      // Ignore malformed/truncated tool results.
    }
  }

  return charts;
}
