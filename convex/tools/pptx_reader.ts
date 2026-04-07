// convex/tools/pptx_reader.ts
// =============================================================================
// Lightweight .pptx text/structure extractor using JSZip.
//
// A .pptx file is a ZIP archive containing:
//   ppt/presentation.xml  — slide ordering and size
//   ppt/slides/slide1.xml — individual slide XML (OOXML DrawingML)
//   ppt/notesSlides/notesSlide1.xml — speaker notes
//   ppt/slides/_rels/slide1.xml.rels — relationships (layouts, images)
//
// Paragraph text lives in <a:p> elements with <a:r><a:t> text runs.
// We extract text per slide, detect titles via placeholder types and
// font sizes, and produce structured output.
//
// Replaces any need for heavy PPTX parsing libraries that won't run in
// Convex's sandboxed V8 runtime.
// =============================================================================

import { ConvexError } from "convex/values";
import JSZip from "jszip";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PptxTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export interface PptxParagraph {
  runs: PptxTextRun[];
  text: string;
  /** Detected role: "title", "subtitle", "body", "notes" */
  role: string;
}

export interface PptxSlideExtraction {
  slideNumber: number;
  title: string;
  bodyParagraphs: PptxParagraph[];
  notesParagraphs: PptxParagraph[];
  /** All text from this slide (title + body), newline-separated */
  text: string;
  /** Speaker notes text */
  notesText: string;
}

export interface PptxExtraction {
  slides: PptxSlideExtraction[];
  /** All text, newline-separated */
  text: string;
  /** Structured markdown */
  markdown: string;
  slideCount: number;
  wordCount: number;
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Extract all <a:p> paragraphs from OOXML content.
 * Each paragraph contains <a:r> runs with <a:t> text.
 */
function extractParagraphs(xml: string, defaultRole: string): PptxParagraph[] {
  const paragraphs: PptxParagraph[] = [];
  const pRegex = /<a:p[\s>][\s\S]*?<\/a:p>/g;
  const matches = [...xml.matchAll(pRegex)];

  for (const [pXml] of matches) {
    const runs: PptxTextRun[] = [];

    // Extract text runs <a:r>...<a:t>text</a:t>...</a:r>
    const rRegex = /<a:r>([\s\S]*?)<\/a:r>/g;
    let rMatch;
    while ((rMatch = rRegex.exec(pXml)) !== null) {
      const runXml = rMatch[1];

      // Get text from <a:t>
      const tMatch = runXml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/);
      if (!tMatch) continue;

      const text = decodeXmlEntities(tMatch[1]);
      const bold = /<a:rPr[^>]*\bb="1"/.test(runXml);
      const italic = /<a:rPr[^>]*\bi="1"/.test(runXml);

      runs.push({ text, bold: bold || undefined, italic: italic || undefined });
    }

    // Also check for <a:fld> (field codes like slide numbers, dates)
    const fldRegex = /<a:fld[^>]*>[\s\S]*?<a:t[^>]*>([\s\S]*?)<\/a:t>[\s\S]*?<\/a:fld>/g;
    let fldMatch;
    while ((fldMatch = fldRegex.exec(pXml)) !== null) {
      const text = decodeXmlEntities(fldMatch[1]);
      if (text.trim()) {
        runs.push({ text });
      }
    }

    const fullText = runs.map((r) => r.text).join("");
    if (!fullText.trim()) continue;

    paragraphs.push({
      runs,
      text: fullText,
      role: defaultRole,
    });
  }

  return paragraphs;
}

/**
 * Detect placeholder type from shape XML.
 * Returns "title", "subtitle", "body", or null.
 */
function detectPlaceholderType(shapeXml: string): string | null {
  // <p:ph type="title" /> or <p:ph type="ctrTitle" />
  const phMatch = shapeXml.match(/<p:ph[^>]*type="([^"]+)"/);
  if (phMatch) {
    const t = phMatch[1].toLowerCase();
    if (t === "title" || t === "ctrtitle") return "title";
    if (t === "subtitle" || t === "subttitle") return "subtitle";
    if (t === "body" || t === "obj") return "body";
    // "ftr" (footer), "sldnum" (slide number), "dt" (date) — skip
    return null;
  }
  // No type attribute — could be a default body placeholder
  if (/<p:ph\s*\/>/.test(shapeXml)) return "body";
  return null;
}

// ---------------------------------------------------------------------------
// Slide ordering from presentation.xml
// ---------------------------------------------------------------------------

/**
 * Extract the ordered list of slide relationship IDs from presentation.xml,
 * then resolve them to actual slide file paths via _rels/presentation.xml.rels.
 */
async function getOrderedSlideFiles(
  zip: JSZip,
): Promise<string[]> {
  // Get presentation.xml for slide order
  const presFile = zip.file("ppt/presentation.xml");
  if (!presFile) {
    // Fallback: just enumerate ppt/slides/slide*.xml sorted numerically
    return getFallbackSlideFiles(zip);
  }

  const presXml = await presFile.async("string");

  // Extract rId references in order: <p:sldIdLst><p:sldId id="..." r:id="rId2"/>...
  const sldIdRegex = /<p:sldId[^>]*r:id="([^"]+)"/g;
  const rIds: string[] = [];
  let m;
  while ((m = sldIdRegex.exec(presXml)) !== null) {
    rIds.push(m[1]);
  }

  if (rIds.length === 0) return getFallbackSlideFiles(zip);

  // Resolve rIds to file paths via _rels/presentation.xml.rels
  const relsFile = zip.file("ppt/_rels/presentation.xml.rels");
  if (!relsFile) return getFallbackSlideFiles(zip);

  const relsXml = await relsFile.async("string");
  const relMap = new Map<string, string>();
  const relRegex = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  while ((m = relRegex.exec(relsXml)) !== null) {
    relMap.set(m[1], m[2]);
  }

  const slidePaths: string[] = [];
  for (const rId of rIds) {
    const target = relMap.get(rId);
    if (target) {
      // Target is relative to ppt/, e.g. "slides/slide1.xml"
      const fullPath = target.startsWith("ppt/") ? target : `ppt/${target}`;
      slidePaths.push(fullPath);
    }
  }

  return slidePaths.length > 0 ? slidePaths : getFallbackSlideFiles(zip);
}

/** Fallback: enumerate slide files sorted by number. */
function getFallbackSlideFiles(zip: JSZip): string[] {
  const slideFiles: string[] = [];
  zip.forEach((path) => {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(path)) {
      slideFiles.push(path);
    }
  });
  // Sort by slide number
  slideFiles.sort((a, b) => {
    const numA = parseInt(a.match(/slide(\d+)/)?.[1] ?? "0");
    const numB = parseInt(b.match(/slide(\d+)/)?.[1] ?? "0");
    return numA - numB;
  });
  return slideFiles;
}

// ---------------------------------------------------------------------------
// Notes resolution
// ---------------------------------------------------------------------------

/**
 * Find the notes file for a given slide path.
 * Looks up the slide's .rels to find the notesSlide relationship.
 */
async function getNotesForSlide(
  zip: JSZip,
  slidePath: string,
): Promise<string | null> {
  // e.g. ppt/slides/slide1.xml → ppt/slides/_rels/slide1.xml.rels
  const slideFilename = slidePath.split("/").pop()!;
  const relsPath = slidePath.replace(
    slideFilename,
    `_rels/${slideFilename}.rels`,
  );

  const relsFile = zip.file(relsPath);
  if (!relsFile) return null;

  const relsXml = await relsFile.async("string");

  // Find notesSlide relationship
  const noteRelRegex =
    /<Relationship[^>]*Type="[^"]*notesSlide"[^>]*Target="([^"]+)"/;
  const match = relsXml.match(noteRelRegex);
  if (!match) return null;

  // Target is relative, e.g. "../notesSlides/notesSlide1.xml"
  const target = match[1];
  // Resolve relative path
  let notesPath: string;
  if (target.startsWith("../")) {
    notesPath = `ppt/${target.replace("../", "")}`;
  } else if (target.startsWith("ppt/")) {
    notesPath = target;
  } else {
    notesPath = `ppt/notesSlides/${target}`;
  }

  const notesFile = zip.file(notesPath);
  if (!notesFile) return null;

  return await notesFile.async("string");
}

// ---------------------------------------------------------------------------
// Main extraction
// ---------------------------------------------------------------------------

/**
 * Extract text and structure from a .pptx file's raw bytes.
 *
 * @param data ArrayBuffer or Uint8Array of the .pptx file
 * @returns Structured extraction with slides, text, markdown
 */
export async function extractPptxContent(
  data: ArrayBuffer | Uint8Array,
): Promise<PptxExtraction> {
  const zip = await JSZip.loadAsync(data);

  const slidePaths = await getOrderedSlideFiles(zip);
  if (slidePaths.length === 0) {
    throw new ConvexError({
      code: "INVALID_INPUT" as const,
      message: "Invalid .pptx: no slides found — file may be corrupt or not a PowerPoint file",
    });
  }

  const slides: PptxSlideExtraction[] = [];
  const allTextParts: string[] = [];
  let markdown = "";

  for (let i = 0; i < slidePaths.length; i++) {
    const slidePath = slidePaths[i];
    const slideFile = zip.file(slidePath);
    if (!slideFile) continue;

    const slideXml = await slideFile.async("string");
    const slideNum = i + 1;

    // ── Extract shapes with placeholder detection ──
    // Match <p:sp> shape elements
    const spRegex = /<p:sp[\s>][\s\S]*?<\/p:sp>/g;
    const shapes = [...slideXml.matchAll(spRegex)];

    let title = "";
    const bodyParagraphs: PptxParagraph[] = [];

    for (const [shapeXml] of shapes) {
      const phType = detectPlaceholderType(shapeXml);

      // Extract paragraphs from this shape's <p:txBody>
      const txBodyMatch = shapeXml.match(
        /<p:txBody>([\s\S]*?)<\/p:txBody>/,
      );
      if (!txBodyMatch) continue;

      const role = phType ?? "body";
      const paras = extractParagraphs(txBodyMatch[1], role);

      if (phType === "title" && paras.length > 0) {
        title = paras.map((p) => p.text).join(" ");
      } else if (phType === "subtitle") {
        for (const p of paras) {
          p.role = "subtitle";
          bodyParagraphs.push(p);
        }
      } else if (paras.length > 0) {
        bodyParagraphs.push(...paras);
      }
    }

    // If no title from placeholder, use first body paragraph as title
    if (!title && bodyParagraphs.length > 0) {
      title = bodyParagraphs[0].text;
      bodyParagraphs[0].role = "title";
    }

    // ── Extract speaker notes ──
    const notesParagraphs: PptxParagraph[] = [];
    const notesXml = await getNotesForSlide(zip, slidePath);
    if (notesXml) {
      // Notes are in <p:txBody> within the notes slide
      const notesTxBodyRegex = /<p:txBody>([\s\S]*?)<\/p:txBody>/g;
      let ntMatch;
      while ((ntMatch = notesTxBodyRegex.exec(notesXml)) !== null) {
        const paras = extractParagraphs(ntMatch[1], "notes");
        // Filter out slide number/date placeholder text
        for (const p of paras) {
          if (p.text.trim() && !p.text.match(/^\d+$/)) {
            notesParagraphs.push(p);
          }
        }
      }
    }

    // ── Build text representations ──
    const bodyText = bodyParagraphs.map((p) => p.text).join("\n");
    const notesText = notesParagraphs.map((p) => p.text).join("\n");
    const slideText = [title, bodyText].filter(Boolean).join("\n");

    slides.push({
      slideNumber: slideNum,
      title,
      bodyParagraphs,
      notesParagraphs,
      text: slideText,
      notesText,
    });

    allTextParts.push(slideText);
    if (notesText) allTextParts.push(notesText);

    // ── Build markdown ──
    markdown += `## Slide ${slideNum}`;
    if (title) markdown += `: ${title}`;
    markdown += "\n\n";

    for (const p of bodyParagraphs) {
      if (p.role === "subtitle") {
        markdown += `*${p.text}*\n\n`;
      } else {
        markdown += `- ${p.text}\n`;
      }
    }
    if (bodyParagraphs.length > 0) markdown += "\n";

    if (notesText) {
      markdown += `> **Notes:** ${notesText}\n\n`;
    }
  }

  const fullText = allTextParts.join("\n");
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;

  return {
    slides,
    text: fullText,
    markdown: markdown.trim(),
    slideCount: slidePaths.length,
    wordCount,
  };
}
