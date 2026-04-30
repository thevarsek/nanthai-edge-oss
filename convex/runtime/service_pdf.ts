"use node";

import * as path from "node:path";
import { ConvexError } from "convex/values";
import { ToolExecutionContext } from "../tools/registry";
import { getOrCreatePersistentRuntime } from "./service_vm";
import { resolveOwnedStorageFile } from "./storage";
import { storeArtifactBytes } from "./service_artifacts";

const PDF_TIMEOUT_MS = 5 * 60 * 1000;

interface ReadPdfPage {
  pageNumber: number;
  charCount: number;
  textExcerpt: string;
}

interface ReadPdfResult {
  filename: string;
  storageId: string;
  pageCount: number;
  text: string;
  textTruncated: boolean;
  fullTextCharCount: number;
  pages: ReadPdfPage[];
  metadata: Record<string, string>;
}

interface GeneratedPdfResult {
  storageId: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  downloadUrl?: string | null;
  markdownLink?: string;
}

type PersistentPdfRuntime = Awaited<ReturnType<typeof getOrCreatePersistentRuntime>>;

async function installPythonPackages(sandbox: any, packages: string[]): Promise<void> {
  if (packages.length === 0) return;
  await sandbox.runCommand("pip", ["install", "-q", ...packages]);
}

async function runPdfProgram(
  runtime: PersistentPdfRuntime,
  input: Record<string, unknown>,
  pythonSource: string,
  packages: string[],
) {
  const { sandbox, workspace } = runtime;
  await installPythonPackages(sandbox, packages);

  const inputPath = `${workspace.root}/pdf_input.json`;
  const scriptPath = `${workspace.root}/pdf_tool.py`;
  const resultPath = `${workspace.outputs}/pdf_result.json`;
  await sandbox.writeFiles([
    { path: inputPath, content: JSON.stringify({ ...input, resultPath }) },
    { path: scriptPath, content: pythonSource },
  ]);

  const result = await sandbox.runCommand("python3", [scriptPath, inputPath], {
    signal: AbortSignal.timeout(PDF_TIMEOUT_MS),
  });
  const stdout = await result.stdout();
  const stderr = await result.stderr();
  if (result.exitCode !== 0) {
    throw new ConvexError({
      code: "INTERNAL_ERROR" as const,
      message:
        `PDF runtime failed with exit code ${result.exitCode}.` +
        (stderr ? `\n${stderr}` : stdout ? `\n${stdout}` : ""),
    });
  }

  const resultBuffer = await sandbox.readFileToBuffer({ path: resultPath });
  if (!resultBuffer) {
    throw new ConvexError({
      code: "INTERNAL_ERROR" as const,
      message: "PDF runtime did not produce a result payload.",
    });
  }
  return {
    sandbox,
    workspace,
    payload: JSON.parse(Buffer.from(resultBuffer).toString("utf8")) as Record<string, unknown>,
  };
}

export async function readPdfFromStorage(
  toolCtx: ToolExecutionContext,
  storageId: string,
): Promise<ReadPdfResult> {
  return readPdfFromStorageInternal(toolCtx, storageId, true);
}

export async function readPdfBlob(
  toolCtx: ToolExecutionContext,
  blob: Blob,
  filename: string,
): Promise<ReadPdfResult> {
  return readPdfBlobInternal(toolCtx, blob, filename, true);
}

async function readPdfFromStorageInternal(
  toolCtx: ToolExecutionContext,
  storageId: string,
  includeText: boolean,
): Promise<ReadPdfResult> {
  const runtime = await getOrCreatePersistentRuntime(
    toolCtx,
    "python",
    PDF_TIMEOUT_MS,
  );
  const { record, blob } = await resolveOwnedStorageFile(toolCtx, storageId);
  return readPdfBlobWithRuntime(runtime, blob, record.filename, includeText);
}

async function readPdfBlobInternal(
  toolCtx: ToolExecutionContext,
  blob: Blob,
  filename: string,
  includeText: boolean,
): Promise<ReadPdfResult> {
  const runtime = await getOrCreatePersistentRuntime(
    toolCtx,
    "python",
    PDF_TIMEOUT_MS,
  );
  return readPdfBlobWithRuntime(runtime, blob, filename, includeText);
}

async function readPdfBlobWithRuntime(
  runtime: PersistentPdfRuntime,
  blob: Blob,
  filename: string,
  includeText: boolean,
): Promise<ReadPdfResult> {
  const { sandbox, workspace } = runtime;
  const pdfPath = path.posix.join(workspace.inputs, filename.replace(/[^\w.-]+/g, "_"));
  await sandbox.writeFiles([{ path: pdfPath, content: new Uint8Array(await blob.arrayBuffer()) }]);

  const python = includeText
    ? `
import json, sys
from pypdf import PdfReader

input_path = sys.argv[1]
payload = json.load(open(input_path))
pdf_path = payload["pdfPath"]
result_path = payload["resultPath"]

reader = PdfReader(pdf_path)
pages = []
all_text = []
for index, page in enumerate(reader.pages):
    text = page.extract_text() or ""
    all_text.append(text)
    pages.append({
        "pageNumber": index + 1,
        "charCount": len(text),
        "textExcerpt": text[:2000],
    })

full_text = "\\n\\n".join([t for t in all_text if t])
result = {
    "filename": payload["filename"],
    "storageId": payload["storageId"],
    "pageCount": len(reader.pages),
    "text": full_text,
    "textTruncated": False,
    "fullTextCharCount": len(full_text),
    "pages": pages,
    "metadata": {k: str(v) for k, v in (reader.metadata or {}).items()},
}
with open(result_path, "w", encoding="utf-8") as f:
    json.dump(result, f)
`.trim()
    : `
import json, sys
from pypdf import PdfReader

input_path = sys.argv[1]
payload = json.load(open(input_path))
pdf_path = payload["pdfPath"]
result_path = payload["resultPath"]

reader = PdfReader(pdf_path)
result = {
    "filename": payload["filename"],
    "storageId": payload["storageId"],
    "pageCount": len(reader.pages),
    "text": "",
    "textTruncated": False,
    "fullTextCharCount": 0,
    "pages": [],
    "metadata": {k: str(v) for k, v in (reader.metadata or {}).items()},
}
with open(result_path, "w", encoding="utf-8") as f:
    json.dump(result, f)
`.trim();

  const { payload } = await runPdfProgram(
    runtime,
    { pdfPath, filename, storageId: "document-version" },
    python,
    ["pypdf"],
  );
  return payload as unknown as ReadPdfResult;
}

interface PdfSectionInput {
  heading?: string;
  body: string;
}

async function buildPdfFromSections(
  toolCtx: ToolExecutionContext,
  args: {
    title: string;
    filename?: string;
    author?: string;
    sections: PdfSectionInput[];
  },
): Promise<GeneratedPdfResult> {
  const safeFilename = (args.filename?.trim() || `${args.title}.pdf`).replace(/[^\w.\- ]+/g, "_");
  const python = `
import json, sys
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

payload = json.load(open(sys.argv[1]))
result_path = payload["resultPath"]
pdf_path = payload["pdfPath"]
styles = getSampleStyleSheet()
story = [Paragraph(payload["title"], styles["Title"]), Spacer(1, 0.25 * inch)]
for section in payload["sections"]:
    heading = section.get("heading")
    body = section.get("body", "")
    if heading:
        story.append(Paragraph(heading, styles["Heading2"]))
        story.append(Spacer(1, 0.12 * inch))
    for paragraph in [p for p in body.split("\\n\\n") if p.strip()]:
        story.append(Paragraph(paragraph.replace("\\n", "<br/>"), styles["BodyText"]))
        story.append(Spacer(1, 0.12 * inch))
doc = SimpleDocTemplate(pdf_path, title=payload["title"], author=payload.get("author") or "NanthAI")
doc.build(story)
with open(result_path, "w", encoding="utf-8") as f:
    json.dump({"pdfPath": pdf_path}, f)
`.trim();

  const runtime = await getOrCreatePersistentRuntime(
    toolCtx,
    "python",
    PDF_TIMEOUT_MS,
  );
  const { workspace, sandbox } = runtime;
  const pdfPath = `${workspace.outputs}/${safeFilename.endsWith(".pdf") ? safeFilename : `${safeFilename}.pdf`}`;
  await runPdfProgram(
    runtime,
    {
      title: args.title,
      author: args.author,
      sections: args.sections,
      pdfPath,
    },
    python,
    ["reportlab"],
  );
  const pdfBuffer = await sandbox.readFileToBuffer({ path: pdfPath });
  if (!pdfBuffer) {
    throw new ConvexError({
      code: "INTERNAL_ERROR" as const,
      message: "PDF runtime did not produce the generated PDF file.",
    });
  }
  return storeArtifactBytes(
    toolCtx,
    new Uint8Array(pdfBuffer),
    path.posix.basename(pdfPath),
    "application/pdf",
  );
}

export async function generatePdfDocument(
  toolCtx: ToolExecutionContext,
  args: {
    title: string;
    filename?: string;
    author?: string;
    sections: PdfSectionInput[];
  },
): Promise<GeneratedPdfResult> {
  return buildPdfFromSections(toolCtx, args);
}

export async function editPdfDocument(
  toolCtx: ToolExecutionContext,
  args: {
    storageId: string;
    title: string;
    filename?: string;
    author?: string;
    sections: PdfSectionInput[];
  },
): Promise<GeneratedPdfResult & {
  sourceStorageId: string;
  sourcePageCount: number;
  regenerated: true;
}> {
  const existing = await readPdfFromStorageInternal(toolCtx, args.storageId, false);
  const generated = await buildPdfFromSections(toolCtx, {
    title: args.title,
    filename: args.filename,
    author: args.author,
    sections: args.sections,
  });
  return {
    sourceStorageId: args.storageId,
    sourcePageCount: existing.pageCount,
    regenerated: true,
    ...generated,
  };
}
