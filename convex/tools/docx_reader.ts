// convex/tools/docx_reader.ts
// =============================================================================
// Lightweight .docx text extractor using JSZip.
//
// A .docx file is a ZIP archive; the main content lives in
// `word/document.xml` as OOXML. We extract paragraphs, detect heading
// styles, and produce both plain text and Markdown.
//
// This replaces mammoth, which depends on bluebird and uses `new Function()`
// — banned in Convex's sandboxed V8 runtime.
// =============================================================================

import { ConvexError } from "convex/values";
import JSZip from "jszip";

export interface DocxParagraph {
  style: string; // "Title", "Heading1", "Heading2", "Normal", etc.
  text: string;
}

export interface DocxExtraction {
  paragraphs: DocxParagraph[];
  text: string; // plain text, newline-separated
  markdown: string; // heading-aware markdown
  wordCount: number;
}

/**
 * Decode common XML entities to plain text.
 */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Extract text and structure from a .docx file's raw bytes.
 *
 * @param data ArrayBuffer or Uint8Array of the .docx file
 * @returns Structured extraction with paragraphs, text, markdown, word count
 */
export async function extractDocxContent(
  data: ArrayBuffer | Uint8Array,
): Promise<DocxExtraction> {
  const zip = await JSZip.loadAsync(data);

  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    throw new ConvexError({
      code: "INVALID_INPUT" as const,
      message: "Invalid .docx: missing word/document.xml — file may be corrupt or not a Word document",
    });
  }

  const xml = await docFile.async("string");

  // Match each <w:p> paragraph element (non-greedy within body).
  const pRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  const matches = [...xml.matchAll(pRegex)];

  const paragraphs: DocxParagraph[] = [];
  const textLines: string[] = [];
  let markdown = "";

  for (const [pXml] of matches) {
    // Detect paragraph style (Title, Heading1, Heading2, etc.)
    const styleMatch = pXml.match(/<w:pStyle w:val="([^"]+)"/);
    const style = styleMatch ? styleMatch[1] : "Normal";

    // Extract all <w:t> text runs and concatenate.
    const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    const textParts: string[] = [];
    let m;
    while ((m = tRegex.exec(pXml)) !== null) {
      textParts.push(decodeXmlEntities(m[1]));
    }
    const text = textParts.join("");

    // Skip empty paragraphs.
    if (!text.trim()) continue;

    paragraphs.push({ style, text });
    textLines.push(text);

    // Build heading-aware markdown.
    if (style === "Title") {
      markdown += `# ${text}\n\n`;
    } else if (style === "Heading1") {
      markdown += `## ${text}\n\n`;
    } else if (style === "Heading2") {
      markdown += `### ${text}\n\n`;
    } else if (style === "Heading3") {
      markdown += `#### ${text}\n\n`;
    } else if (style === "Heading4") {
      markdown += `##### ${text}\n\n`;
    } else if (style === "Heading5" || style === "Heading6") {
      markdown += `###### ${text}\n\n`;
    } else if (style.startsWith("ListParagraph") || style === "ListBullet") {
      markdown += `- ${text}\n`;
    } else {
      markdown += `${text}\n\n`;
    }
  }

  const plainText = textLines.join("\n");
  const wordCount = plainText.split(/\s+/).filter(Boolean).length;

  return {
    paragraphs,
    text: plainText,
    markdown: markdown.trim(),
    wordCount,
  };
}
