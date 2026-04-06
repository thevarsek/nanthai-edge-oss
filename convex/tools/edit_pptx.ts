// convex/tools/edit_pptx.ts
// =============================================================================
// Tool: edit_pptx — reads an existing .pptx from Convex storage, then generates
// a new version with the provided updated slides.
//
// This is a "read → regenerate" approach (same as edit_docx). The model reads
// the original via read_pptx for context, then provides the full updated slide
// list here. True in-place OOXML editing of .pptx is extremely fragile, and
// unnecessary for LLM workflows where the model already knows the new content.
//
// Supports the same extended params as generate_pptx: theme, section/table/chart
// layouts, slide numbers, background images.
//
// Images are referenced by `imageStorageId` (from fetch_image) and resolved
// internally — keeping the conversation context small.
// =============================================================================

import PptxGenJS from "pptxgenjs";
import { extractPptxContent } from "./pptx_reader";
import { createTool } from "./registry";
import { sanitizeFilename } from "./sanitize";
import {
  ImageInput,
  ResolvedImage,
  resolveSlideImages,
} from "./image_resolver";

// ---------------------------------------------------------------------------
// Types (shared with generate_pptx)
// ---------------------------------------------------------------------------

interface PptxThemeInput {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  titleFont?: string;
  bodyFont?: string;
  titleFontSize?: number;
  bodyFontSize?: number;
  backgroundColor?: string;
}

interface PptxTableInput {
  headers: string[];
  rows: string[][];
}

interface PptxChartInput {
  type: string;
  title?: string;
  labels: string[];
  datasets: Array<{
    name: string;
    values: number[];
    color?: string;
  }>;
}

interface PptxSlideInput {
  title: string;
  body?: string;
  notes?: string;
  layout?: string;
  images?: ImageInput[];
  backgroundImage?: ImageInput;
  table?: PptxTableInput;
  chart?: PptxChartInput;
}

interface ResolvedTheme {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  titleFont: string;
  bodyFont: string;
  titleFontSize: number;
  bodyFontSize: number;
  backgroundColor: string;
  titleBg: string;
  titleText: string;
  slideTitleText: string;
  bodyText: string;
}

function resolveTheme(input?: PptxThemeInput): ResolvedTheme {
  const primary = input?.primaryColor?.replace("#", "") || "003B6F";
  const secondary = input?.secondaryColor?.replace("#", "") || "0066B2";
  const accent = input?.accentColor?.replace("#", "") || "E74C3C";
  const titleFont = input?.titleFont || "Calibri";
  const bodyFont = input?.bodyFont || titleFont;
  const titleFontSize = input?.titleFontSize || 24;
  const bodyFontSize = input?.bodyFontSize || 16;
  const backgroundColor = input?.backgroundColor?.replace("#", "") || "FFFFFF";

  return {
    primaryColor: primary, secondaryColor: secondary, accentColor: accent,
    titleFont, bodyFont, titleFontSize, bodyFontSize, backgroundColor,
    titleBg: primary, titleText: "FFFFFF", slideTitleText: primary, bodyText: "333333",
  };
}

// ---------------------------------------------------------------------------
// Slide layout builders (shared logic with generate_pptx)
// ---------------------------------------------------------------------------

function buildTextSlide(
  pptx: PptxGenJS, s: PptxGenJS.Slide,
  title: string, body: string | undefined, images: ResolvedImage[], theme: ResolvedTheme,
): void {
  s.addText(title, {
    x: 0.5, y: 0.3, w: 12.33, h: 0.8,
    fontSize: theme.titleFontSize, fontFace: theme.titleFont,
    bold: true, color: theme.slideTitleText, valign: "middle",
  });
  s.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 1.15, w: 12.33, h: 0.02, fill: { color: theme.titleBg },
  });

  const bodyLines = (body ?? "").split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (bodyLines.length > 0) {
    const textRows = bodyLines.map((line) => ({
      text: line.replace(/^[-•*]\s*/, ""),
      options: {
        fontSize: theme.bodyFontSize, fontFace: theme.bodyFont, color: theme.bodyText,
        bullet: { type: "bullet" as const }, breakLine: true, paraSpaceAfter: 6,
      },
    }));
    s.addText(textRows, {
      x: 0.5, y: 1.4, w: images.length > 0 ? 7.5 : 12.33, h: 5.5, valign: "top",
    });
  }

  if (images.length > 0) {
    const maxImages = Math.min(images.length, 3);
    const imgH = 5.2 / maxImages;
    for (let i = 0; i < maxImages; i++) {
      s.addImage({
        data: images[i].data,
        x: 8.5, y: 1.4 + i * (imgH + 0.1), w: 4.33, h: imgH - 0.1,
        altText: images[i].altText,
      });
    }
  }
}

function buildSplitSlide(
  pptx: PptxGenJS, s: PptxGenJS.Slide,
  title: string, body: string | undefined, images: ResolvedImage[], theme: ResolvedTheme,
): void {
  s.addText(title, {
    x: 0.5, y: 0.3, w: 12.33, h: 0.8,
    fontSize: theme.titleFontSize, fontFace: theme.titleFont,
    bold: true, color: theme.slideTitleText, valign: "middle",
  });
  s.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 1.15, w: 12.33, h: 0.02, fill: { color: theme.titleBg },
  });

  const bodyLines = (body ?? "").split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (bodyLines.length > 0) {
    const textRows = bodyLines.map((line) => ({
      text: line.replace(/^[-•*]\s*/, ""),
      options: {
        fontSize: theme.bodyFontSize - 1, fontFace: theme.bodyFont, color: theme.bodyText,
        bullet: { type: "bullet" as const }, breakLine: true, paraSpaceAfter: 6,
      },
    }));
    s.addText(textRows, { x: 0.5, y: 1.4, w: 5.8, h: 5.5, valign: "top" });
  }

  if (images.length > 0) {
    s.addImage({ data: images[0].data, x: 6.8, y: 1.4, w: 6.0, h: 5.5, altText: images[0].altText });
  }
}

function buildImageSlide(
  _pptx: PptxGenJS, s: PptxGenJS.Slide,
  title: string, body: string | undefined, images: ResolvedImage[], theme: ResolvedTheme,
): void {
  s.addText(title, {
    x: 0.5, y: 0.2, w: 12.33, h: 0.6,
    fontSize: theme.titleFontSize - 4, fontFace: theme.titleFont,
    bold: true, color: theme.slideTitleText, valign: "middle",
  });

  if (images.length === 0) return;

  const gridX = 0.5, gridY = 0.9, gridW = 12.33, gridH = 6.1, gap = 0.15;
  let cols: number, rows: number;
  const n = Math.min(images.length, 9);

  if (n === 1) { cols = 1; rows = 1; }
  else if (n === 2) { cols = 2; rows = 1; }
  else if (n <= 4) { cols = 2; rows = 2; }
  else if (n <= 6) { cols = 3; rows = 2; }
  else { cols = 3; rows = 3; }

  const cellW = (gridW - gap * (cols - 1)) / cols;
  const cellH = (gridH - gap * (rows - 1)) / rows;

  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    s.addImage({
      data: images[i].data,
      x: gridX + col * (cellW + gap), y: gridY + row * (cellH + gap),
      w: cellW, h: cellH, altText: images[i].altText,
    });
  }

  if (body && images.length <= 4) {
    s.addText(body, {
      x: 0.5, y: gridY + gridH + 0.05, w: 12.33, h: 0.35,
      fontSize: 10, fontFace: theme.bodyFont, color: theme.bodyText, align: "center",
    });
  }
}

function buildSectionSlide(
  _pptx: PptxGenJS, s: PptxGenJS.Slide,
  title: string, body: string | undefined, theme: ResolvedTheme,
): void {
  s.background = { color: theme.titleBg };
  s.addText(title, {
    x: 1.0, y: 2.0, w: 11.33, h: 2.0,
    fontSize: theme.titleFontSize + 12, fontFace: theme.titleFont,
    bold: true, color: theme.titleText, align: "center", valign: "middle",
  });
  if (body) {
    s.addText(body, {
      x: 1.0, y: 4.2, w: 11.33, h: 1.0,
      fontSize: theme.bodyFontSize + 2, fontFace: theme.bodyFont,
      color: theme.titleText, align: "center", valign: "top",
    });
  }
}

function buildTableSlide(
  pptx: PptxGenJS, s: PptxGenJS.Slide,
  title: string, tableInput: PptxTableInput, theme: ResolvedTheme,
): void {
  s.addText(title, {
    x: 0.5, y: 0.3, w: 12.33, h: 0.8,
    fontSize: theme.titleFontSize, fontFace: theme.titleFont,
    bold: true, color: theme.slideTitleText, valign: "middle",
  });
  s.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 1.15, w: 12.33, h: 0.02, fill: { color: theme.titleBg },
  });

  const headerRow = tableInput.headers.map((h) => ({
    text: h,
    options: {
      bold: true, fontSize: theme.bodyFontSize - 2, fontFace: theme.bodyFont,
      color: "FFFFFF", fill: { color: theme.titleBg },
    },
  }));
  const dataRows = tableInput.rows.map((row) =>
    row.map((cell) => ({
      text: cell ?? "",
      options: { fontSize: theme.bodyFontSize - 2, fontFace: theme.bodyFont, color: theme.bodyText },
    })),
  );

  s.addTable([headerRow, ...dataRows], {
    x: 0.5, y: 1.4, w: 12.33,
    border: { type: "solid", pt: 0.5, color: "CCCCCC" },
    colW: Array(tableInput.headers.length).fill(12.33 / tableInput.headers.length),
    autoPage: true,
  });
}

function buildChartSlide(
  _pptx: PptxGenJS, s: PptxGenJS.Slide,
  title: string, chartInput: PptxChartInput, theme: ResolvedTheme,
): void {
  s.addText(chartInput.title || title, {
    x: 0.5, y: 0.3, w: 12.33, h: 0.8,
    fontSize: theme.titleFontSize, fontFace: theme.titleFont,
    bold: true, color: theme.slideTitleText, valign: "middle",
  });

  const CHART_TYPES: Record<string, PptxGenJS.CHART_NAME> = {
    bar: _pptx.ChartType.bar, line: _pptx.ChartType.line,
    pie: _pptx.ChartType.pie, doughnut: _pptx.ChartType.doughnut, area: _pptx.ChartType.area,
  };
  const chartType = CHART_TYPES[(chartInput.type || "bar").toLowerCase()] || _pptx.ChartType.bar;
  const DEFAULT_COLORS = [
    theme.primaryColor, theme.secondaryColor, theme.accentColor,
    "2ECC71", "F39C12", "9B59B6", "1ABC9C", "E67E22", "34495E", "16A085",
  ];
  const chartData = chartInput.datasets.map((ds) => ({
    name: ds.name, labels: chartInput.labels, values: ds.values,
  }));
  const isPieOrDoughnut = chartInput.type === "pie" || chartInput.type === "doughnut";

  s.addChart(chartType, chartData, {
    x: 0.5, y: 1.2, w: 12.33, h: 5.8,
    showLegend: true, legendPos: "b", legendFontSize: 10,
    showValue: isPieOrDoughnut, showPercent: isPieOrDoughnut,
    catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
    chartColors: chartInput.datasets.map((ds, i) =>
      (ds.color?.replace("#", "") || DEFAULT_COLORS[i % DEFAULT_COLORS.length]),
    ),
  });
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const editPptx = createTool({
  name: "edit_pptx",
  description:
    "Edit a Microsoft PowerPoint presentation (.pptx). Reads the original from " +
    "storage for verification, then generates a new version with the provided " +
    "updated slides. Use when the user wants to modify, rewrite, or update an " +
    "existing PowerPoint file. You must provide the full updated slide list — " +
    "this replaces the entire presentation. First use read_pptx to understand " +
    "the current content, then provide the complete updated slides here. " +
    "Supports the same options as generate_pptx (theme, layouts, charts, tables). " +
    "For images, use imageStorageId from fetch_image — do NOT pass base64 data.",
  parameters: {
    type: "object",
    properties: {
      storageId: {
        type: "string",
        description: "The Convex storage ID of the original .pptx file to edit",
      },
      title: {
        type: "string",
        description: "Presentation title for the updated version",
      },
      subtitle: { type: "string", description: "Optional subtitle for the title slide" },
      slides: {
        type: "array",
        description: "The full updated slide list (replaces all content slides).",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Slide title" },
            body: { type: "string", description: "Slide body text. Newlines separate bullet points." },
            notes: { type: "string", description: "Optional speaker notes" },
            layout: {
              type: "string",
              description: "Slide layout: 'text' (default), 'split', 'image', 'section', 'table', or 'chart'.",
            },
            images: {
              type: "array",
              description: "Images to embed (use imageStorageId from fetch_image)",
              items: {
                type: "object",
                properties: {
                  imageStorageId: { type: "string", description: "Convex storage ID from fetch_image" },
                  altText: { type: "string", description: "Alt text for accessibility" },
                },
                required: ["imageStorageId"],
              },
            },
            backgroundImage: {
              type: "object",
              description: "Full-bleed background image.",
              properties: {
                imageStorageId: { type: "string" },
                altText: { type: "string" },
              },
              required: ["imageStorageId"],
            },
            table: {
              type: "object",
              description: "Table data for 'table' layout.",
              properties: {
                headers: { type: "array", items: { type: "string" } },
                rows: { type: "array", items: { type: "array", items: { type: "string" } } },
              },
              required: ["headers", "rows"],
            },
            chart: {
              type: "object",
              description: "Chart data for 'chart' layout.",
              properties: {
                type: { type: "string", description: "Chart type: 'bar', 'line', 'pie', 'doughnut', 'area'." },
                title: { type: "string" },
                labels: { type: "array", items: { type: "string" } },
                datasets: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      values: { type: "array", items: { type: "number" } },
                      color: { type: "string" },
                    },
                    required: ["name", "values"],
                  },
                },
              },
              required: ["type", "labels", "datasets"],
            },
          },
          required: ["title"],
        },
      },
      theme: {
        type: "object",
        description: "Optional color/font theme (same as generate_pptx).",
        properties: {
          primaryColor: { type: "string" }, secondaryColor: { type: "string" },
          accentColor: { type: "string" }, titleFont: { type: "string" },
          bodyFont: { type: "string" }, titleFontSize: { type: "number" },
          bodyFontSize: { type: "number" }, backgroundColor: { type: "string" },
        },
      },
      showSlideNumbers: { type: "boolean", description: "Show slide numbers (default false)." },
    },
    required: ["storageId", "title", "slides"],
  },

  execute: async (toolCtx, args) => {
    const storageId = args.storageId as string;
    const title = args.title as string;
    const subtitle = (args.subtitle as string) || "";
    const slides = args.slides as PptxSlideInput[];
    const showSlideNumbers = (args.showSlideNumbers as boolean) ?? false;

    if (!storageId || typeof storageId !== "string") {
      return { success: false, data: null, error: "Missing or invalid 'storageId'" };
    }
    if (!title || typeof title !== "string") {
      return { success: false, data: null, error: "Missing or invalid 'title'" };
    }
    if (!Array.isArray(slides) || slides.length === 0) {
      return { success: false, data: null, error: "'slides' must be a non-empty array" };
    }

    // Step 1: Verify original exists and get stats.
    let originalBlob: Blob | null;
    try {
      originalBlob = await toolCtx.ctx.storage.get(storageId as any);
    } catch {
      return { success: false, data: null, error: `Invalid storageId: "${storageId}"` };
    }
    if (!originalBlob) {
      return { success: false, data: null, error: `Original file not found: "${storageId}"` };
    }

    let originalSlideCount = 0;
    let originalWordCount = 0;
    try {
      const ab = await originalBlob.arrayBuffer();
      const extraction = await extractPptxContent(ab);
      originalSlideCount = extraction.slideCount;
      originalWordCount = extraction.wordCount;
    } catch {
      // Non-fatal.
    }

    const theme = resolveTheme(args.theme as PptxThemeInput | undefined);

    // Step 2: Build the new presentation.
    const pptx = new PptxGenJS();
    pptx.title = title;
    pptx.subject = subtitle || title;
    pptx.author = "NanthAI";
    pptx.layout = "LAYOUT_WIDE";

    // Title slide
    const titleSlide = pptx.addSlide();
    titleSlide.background = { color: theme.titleBg };
    titleSlide.addText(title, {
      x: 0.5, y: 2.0, w: 12.33, h: 1.5,
      fontSize: 36, fontFace: theme.titleFont,
      bold: true, color: theme.titleText, align: "center", valign: "middle",
    });
    if (subtitle) {
      titleSlide.addText(subtitle, {
        x: 0.5, y: 3.6, w: 12.33, h: 0.8,
        fontSize: 18, fontFace: theme.bodyFont,
        color: theme.titleText, align: "center", valign: "top",
      });
    }
    if (showSlideNumbers) {
      titleSlide.slideNumber = { x: 12.0, y: 7.0, fontFace: theme.bodyFont, fontSize: 10, color: theme.titleText };
    }

    // Content slides
    let totalImages = 0;
    const allWarnings: string[] = [];

    for (const slide of slides) {
      const s = pptx.addSlide();
      const layout = (slide.layout ?? "text").toLowerCase();

      if (theme.backgroundColor !== "FFFFFF") {
        s.background = { color: theme.backgroundColor };
      }

      if (slide.backgroundImage) {
        const { resolved: bgImages, warnings: bgWarn } = await resolveSlideImages(toolCtx.ctx, [slide.backgroundImage]);
        allWarnings.push(...bgWarn);
        if (bgImages.length > 0) {
          s.background = { data: bgImages[0].data };
          totalImages++;
        }
      }

      if (showSlideNumbers) {
        s.slideNumber = { x: 12.0, y: 7.0, fontFace: theme.bodyFont, fontSize: 10, color: "888888" };
      }

      const { resolved: images, warnings } = await resolveSlideImages(toolCtx.ctx, slide.images);
      allWarnings.push(...warnings);
      totalImages += images.length;

      switch (layout) {
        case "section":
          buildSectionSlide(pptx, s, slide.title, slide.body, theme);
          break;
        case "table":
          if (slide.table && Array.isArray(slide.table.headers)) {
            buildTableSlide(pptx, s, slide.title, slide.table, theme);
          } else {
            buildTextSlide(pptx, s, slide.title, slide.body, images, theme);
          }
          break;
        case "chart":
          if (slide.chart && Array.isArray(slide.chart.datasets)) {
            buildChartSlide(pptx, s, slide.title, slide.chart, theme);
          } else {
            buildTextSlide(pptx, s, slide.title, slide.body, images, theme);
          }
          break;
        case "image":
          buildImageSlide(pptx, s, slide.title, slide.body, images, theme);
          break;
        case "split":
          buildSplitSlide(pptx, s, slide.title, slide.body, images, theme);
          break;
        case "text":
        default:
          buildTextSlide(pptx, s, slide.title, slide.body, images, theme);
          break;
      }

      if (slide.notes) s.addNotes(slide.notes);
    }

    // Step 3: Export and store.
    const blob = (await pptx.write({ outputType: "blob" })) as Blob;
    const newStorageId = await toolCtx.ctx.storage.store(blob);

    const safeTitle = sanitizeFilename(title, "presentation");
    const filename = `${safeTitle}.pptx`;

    const siteUrl = process.env.CONVEX_SITE_URL;
    const downloadUrl = siteUrl
      ? `${siteUrl}/download?storageId=${encodeURIComponent(newStorageId)}&filename=${encodeURIComponent(filename)}`
      : await toolCtx.ctx.storage.getUrl(newStorageId);

    let message =
      `Presentation edited. Present the download link to the user using markdown: [${filename}](${downloadUrl})`;
    if (allWarnings.length > 0) {
      message += `\n\nWarnings:\n${allWarnings.join("\n")}`;
    }

    return {
      success: true,
      data: {
        originalStorageId: storageId,
        newStorageId,
        downloadUrl,
        filename,
        originalSlideCount,
        originalWordCount,
        newSlideCount: slides.length + 1,
        imageCount: totalImages,
        markdownLink: `[${filename}](${downloadUrl})`,
        message,
      },
    };
  },
});
