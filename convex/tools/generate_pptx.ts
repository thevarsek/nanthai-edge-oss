// convex/tools/generate_pptx.ts
// =============================================================================
// Tool: generate_pptx — creates a PowerPoint presentation and stores it in
// Convex file storage. Returns a download URL the model can present to the user.
//
// Uses pptxgenjs with `write({ outputType: "blob" })` so it works in the
// Convex default V8 runtime without "use node".
//
// Extended capabilities:
// - Custom theme (colors, fonts, font sizes)
// - Section divider slides
// - Table slides
// - Chart slides (bar, line, pie, doughnut)
// - Slide numbers
// - Background images (full-bleed)
//
// Images are referenced by `imageStorageId` (from fetch_image tool) and
// resolved to base64 internally — keeping the model's conversation context
// small. Legacy `data` (raw base64) is also accepted as a fallback.
// =============================================================================

import PptxGenJS from "pptxgenjs";
import { createTool } from "./registry";
import {
  ImageInput,
  ResolvedImage,
  resolveSlideImages,
} from "./image_resolver";
import { sanitizeFilename } from "./sanitize";

// ---------------------------------------------------------------------------
// Types
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
  type: string; // bar, line, pie, doughnut
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
  /** Background image — use imageStorageId from fetch_image. */
  backgroundImage?: ImageInput;
  /** Table data for 'table' layout slides. */
  table?: PptxTableInput;
  /** Chart data for 'chart' layout slides. */
  chart?: PptxChartInput;
}

// ---------------------------------------------------------------------------
// Default theme
// ---------------------------------------------------------------------------

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
    primaryColor: primary,
    secondaryColor: secondary,
    accentColor: accent,
    titleFont,
    bodyFont,
    titleFontSize,
    bodyFontSize,
    backgroundColor,
    // Derived theme colors for backward compat
    titleBg: primary,
    titleText: "FFFFFF",
    slideTitleText: primary,
    bodyText: "333333",
  };
}

// ---------------------------------------------------------------------------
// Slide layout builders
// ---------------------------------------------------------------------------

/** Standard text slide with optional images beside text. */
function buildTextSlide(
  pptx: PptxGenJS,
  s: PptxGenJS.Slide,
  title: string,
  body: string | undefined,
  images: ResolvedImage[],
  theme: ResolvedTheme,
): void {
  s.addText(title, {
    x: 0.5, y: 0.3, w: 12.33, h: 0.8,
    fontSize: theme.titleFontSize, fontFace: theme.titleFont,
    bold: true, color: theme.slideTitleText, valign: "middle",
  });
  s.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 1.15, w: 12.33, h: 0.02,
    fill: { color: theme.titleBg },
  });

  const bodyLines = (body ?? "").split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (bodyLines.length > 0) {
    const textRows = bodyLines.map((line) => ({
      text: line.replace(/^[-•*]\s*/, ""),
      options: {
        fontSize: theme.bodyFontSize, fontFace: theme.bodyFont,
        color: theme.bodyText,
        bullet: { type: "bullet" as const },
        breakLine: true, paraSpaceAfter: 6,
      },
    }));
    const hasImages = images.length > 0;
    s.addText(textRows, {
      x: 0.5, y: 1.4, w: hasImages ? 7.5 : 12.33, h: 5.5, valign: "top",
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

/** Split layout: text on left, single large image on right. */
function buildSplitSlide(
  pptx: PptxGenJS,
  s: PptxGenJS.Slide,
  title: string,
  body: string | undefined,
  images: ResolvedImage[],
  theme: ResolvedTheme,
): void {
  s.addText(title, {
    x: 0.5, y: 0.3, w: 12.33, h: 0.8,
    fontSize: theme.titleFontSize, fontFace: theme.titleFont,
    bold: true, color: theme.slideTitleText, valign: "middle",
  });
  s.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 1.15, w: 12.33, h: 0.02,
    fill: { color: theme.titleBg },
  });

  const bodyLines = (body ?? "").split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (bodyLines.length > 0) {
    const textRows = bodyLines.map((line) => ({
      text: line.replace(/^[-•*]\s*/, ""),
      options: {
        fontSize: theme.bodyFontSize - 1, fontFace: theme.bodyFont,
        color: theme.bodyText,
        bullet: { type: "bullet" as const },
        breakLine: true, paraSpaceAfter: 6,
      },
    }));
    s.addText(textRows, {
      x: 0.5, y: 1.4, w: 5.8, h: 5.5, valign: "top",
    });
  }

  if (images.length > 0) {
    s.addImage({
      data: images[0].data,
      x: 6.8, y: 1.4, w: 6.0, h: 5.5,
      altText: images[0].altText,
    });
  }
}

/** Image grid layout (mood board / gallery). */
function buildImageSlide(
  _pptx: PptxGenJS,
  s: PptxGenJS.Slide,
  title: string,
  body: string | undefined,
  images: ResolvedImage[],
  theme: ResolvedTheme,
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
      x: gridX + col * (cellW + gap),
      y: gridY + row * (cellH + gap),
      w: cellW, h: cellH,
      altText: images[i].altText,
    });
  }

  if (body && images.length <= 4) {
    s.addText(body, {
      x: 0.5, y: gridY + gridH + 0.05, w: 12.33, h: 0.35,
      fontSize: 10, fontFace: theme.bodyFont, color: theme.bodyText, align: "center",
    });
  }
}

/** Section divider slide — large centered text on colored background. */
function buildSectionSlide(
  _pptx: PptxGenJS,
  s: PptxGenJS.Slide,
  title: string,
  body: string | undefined,
  theme: ResolvedTheme,
): void {
  s.background = { color: theme.titleBg };
  s.addText(title, {
    x: 1.0, y: 2.0, w: 11.33, h: 2.0,
    fontSize: theme.titleFontSize + 12, fontFace: theme.titleFont,
    bold: true, color: theme.titleText,
    align: "center", valign: "middle",
  });
  if (body) {
    s.addText(body, {
      x: 1.0, y: 4.2, w: 11.33, h: 1.0,
      fontSize: theme.bodyFontSize + 2, fontFace: theme.bodyFont,
      color: theme.titleText,
      align: "center", valign: "top",
    });
  }
}

/** Table slide — title + table. */
function buildTableSlide(
  pptx: PptxGenJS,
  s: PptxGenJS.Slide,
  title: string,
  tableInput: PptxTableInput,
  theme: ResolvedTheme,
): void {
  s.addText(title, {
    x: 0.5, y: 0.3, w: 12.33, h: 0.8,
    fontSize: theme.titleFontSize, fontFace: theme.titleFont,
    bold: true, color: theme.slideTitleText, valign: "middle",
  });
  s.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 1.15, w: 12.33, h: 0.02,
    fill: { color: theme.titleBg },
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
      options: {
        fontSize: theme.bodyFontSize - 2, fontFace: theme.bodyFont,
        color: theme.bodyText,
      },
    })),
  );

  s.addTable([headerRow, ...dataRows], {
    x: 0.5, y: 1.4, w: 12.33,
    border: { type: "solid", pt: 0.5, color: "CCCCCC" },
    colW: Array(tableInput.headers.length).fill(12.33 / tableInput.headers.length),
    autoPage: true,
  });
}

/** Chart slide — title + chart. */
function buildChartSlide(
  _pptx: PptxGenJS,
  s: PptxGenJS.Slide,
  title: string,
  chartInput: PptxChartInput,
  theme: ResolvedTheme,
): void {
  s.addText(chartInput.title || title, {
    x: 0.5, y: 0.3, w: 12.33, h: 0.8,
    fontSize: theme.titleFontSize, fontFace: theme.titleFont,
    bold: true, color: theme.slideTitleText, valign: "middle",
  });

  // Map chart type string to PptxGenJS chart type
  const CHART_TYPES: Record<string, PptxGenJS.CHART_NAME> = {
    bar: _pptx.ChartType.bar,
    line: _pptx.ChartType.line,
    pie: _pptx.ChartType.pie,
    doughnut: _pptx.ChartType.doughnut,
    area: _pptx.ChartType.area,
  };

  const chartType = CHART_TYPES[(chartInput.type || "bar").toLowerCase()] || _pptx.ChartType.bar;

  // Default chart colors if not specified per dataset
  const DEFAULT_COLORS = [
    theme.primaryColor, theme.secondaryColor, theme.accentColor,
    "2ECC71", "F39C12", "9B59B6", "1ABC9C", "E67E22", "34495E", "16A085",
  ];

  const chartData = chartInput.datasets.map((ds, _i) => ({
    name: ds.name,
    labels: chartInput.labels,
    values: ds.values,
  }));

  const isPieOrDoughnut = chartInput.type === "pie" || chartInput.type === "doughnut";

  s.addChart(chartType, chartData, {
    x: 0.5, y: 1.2, w: 12.33, h: 5.8,
    showLegend: true,
    legendPos: "b",
    legendFontSize: 10,
    showValue: isPieOrDoughnut,
    showPercent: isPieOrDoughnut,
    catAxisLabelFontSize: 10,
    valAxisLabelFontSize: 10,
    chartColors: chartInput.datasets.map((ds, i) =>
      (ds.color?.replace("#", "") || DEFAULT_COLORS[i % DEFAULT_COLORS.length]),
    ),
  });
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const generatePptx = createTool({
  name: "generate_pptx",
  description:
    "Generate a Microsoft PowerPoint presentation (.pptx). " +
    "Use for presentations, pitch decks, slide decks, mood boards, or any " +
    "content the user wants as a downloadable PowerPoint file. " +
    "Each slide has a title, optional body text, optional speaker notes, " +
    "and optional images. To embed images, first use the fetch_image tool " +
    "to get an imageStorageId, then pass that ID in the slide's images array. " +
    "Do NOT pass base64 data directly — use imageStorageId instead. " +
    "Slide layouts: 'text' (default — bullets with optional side images), " +
    "'split' (text left, image right), 'image' (image grid/mood board), " +
    "'section' (section divider — large text on colored background), " +
    "'table' (title + data table), 'chart' (title + chart). " +
    "Optional theme param customizes colors, fonts, and sizes. " +
    "All formatting params are optional with sensible defaults.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Presentation title displayed on the title slide",
      },
      subtitle: {
        type: "string",
        description: "Optional subtitle on the title slide",
      },
      slides: {
        type: "array",
        description: "Ordered list of content slides.",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Slide title",
            },
            body: {
              type: "string",
              description:
                "Slide body text. Use newlines to separate bullet points.",
            },
            notes: {
              type: "string",
              description: "Optional speaker notes for this slide",
            },
            layout: {
              type: "string",
              description:
                "Slide layout: 'text' (default), 'split', 'image', " +
                "'section', 'table', or 'chart'.",
            },
            images: {
              type: "array",
              description:
                "Images to embed. Use imageStorageId from fetch_image. " +
                "For 'text': up to 3 stacked right. 'split': 1 fills right half. " +
                "'image': up to 9 in a grid.",
              items: {
                type: "object",
                properties: {
                  imageStorageId: {
                    type: "string",
                    description: "Convex storage ID from fetch_image (preferred)",
                  },
                  altText: {
                    type: "string",
                    description: "Alt text for accessibility",
                  },
                },
                required: ["imageStorageId"],
              },
            },
            backgroundImage: {
              type: "object",
              description:
                "Full-bleed background image for this slide. Use imageStorageId from fetch_image.",
              properties: {
                imageStorageId: {
                  type: "string",
                  description: "Convex storage ID from fetch_image",
                },
                altText: { type: "string" },
              },
              required: ["imageStorageId"],
            },
            table: {
              type: "object",
              description: "Table data for 'table' layout slides.",
              properties: {
                headers: {
                  type: "array",
                  description: "Column header labels",
                  items: { type: "string" },
                },
                rows: {
                  type: "array",
                  description: "Data rows — each row is an array of cell strings",
                  items: { type: "array", items: { type: "string" } },
                },
              },
              required: ["headers", "rows"],
            },
            chart: {
              type: "object",
              description: "Chart data for 'chart' layout slides.",
              properties: {
                type: {
                  type: "string",
                  description: "Chart type: 'bar', 'line', 'pie', 'doughnut', or 'area'.",
                },
                title: {
                  type: "string",
                  description: "Chart title (defaults to slide title)",
                },
                labels: {
                  type: "array",
                  description: "Category labels (x-axis for bar/line, segments for pie)",
                  items: { type: "string" },
                },
                datasets: {
                  type: "array",
                  description: "One or more data series",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string", description: "Series name" },
                      values: {
                        type: "array",
                        description: "Numeric values (must match labels length)",
                        items: { type: "number" },
                      },
                      color: {
                        type: "string",
                        description: "Optional hex color for this series (e.g. '#3498DB')",
                      },
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
      // ---- Optional theme param ----
      theme: {
        type: "object",
        description:
          "Optional color/font theme. All fields optional — unspecified fields use defaults " +
          "(navy blue primary, Calibri font). Colors as hex without #.",
        properties: {
          primaryColor: {
            type: "string",
            description: "Primary color hex (default '003B6F' navy). Used for title slide bg, slide title text, accents.",
          },
          secondaryColor: {
            type: "string",
            description: "Secondary color hex (default '0066B2'). Used for chart secondary data.",
          },
          accentColor: {
            type: "string",
            description: "Accent color hex (default 'E74C3C' red). Used for highlights.",
          },
          titleFont: {
            type: "string",
            description: "Title font family (default 'Calibri').",
          },
          bodyFont: {
            type: "string",
            description: "Body font family (default same as titleFont).",
          },
          titleFontSize: {
            type: "number",
            description: "Title font size in pt (default 24).",
          },
          bodyFontSize: {
            type: "number",
            description: "Body/bullet font size in pt (default 16).",
          },
          backgroundColor: {
            type: "string",
            description: "Default slide background color hex (default 'FFFFFF' white).",
          },
        },
      },
      showSlideNumbers: {
        type: "boolean",
        description: "Show slide numbers in bottom-right corner (default false).",
      },
    },
    required: ["title", "slides"],
  },

  execute: async (toolCtx, args) => {
    const title = args.title as string;
    const subtitle = (args.subtitle as string) || "";
    const slides = args.slides as PptxSlideInput[];
    const showSlideNumbers = (args.showSlideNumbers as boolean) ?? false;

    if (!title || typeof title !== "string") {
      return { success: false, data: null, error: "Missing or invalid 'title'" };
    }
    if (!Array.isArray(slides) || slides.length === 0) {
      return { success: false, data: null, error: "'slides' must be a non-empty array" };
    }

    const theme = resolveTheme(args.theme as PptxThemeInput | undefined);

    const pptx = new PptxGenJS();
    pptx.title = title;
    pptx.subject = subtitle || title;
    pptx.author = "NanthAI";
    pptx.layout = "LAYOUT_WIDE";

    // -------------------------------------------------------------------
    // Title slide
    // -------------------------------------------------------------------
    const titleSlide = pptx.addSlide();
    titleSlide.background = { color: theme.titleBg };
    titleSlide.addText(title, {
      x: 0.5, y: 2.0, w: 12.33, h: 1.5,
      fontSize: 36, fontFace: theme.titleFont,
      bold: true, color: theme.titleText,
      align: "center", valign: "middle",
    });
    if (subtitle) {
      titleSlide.addText(subtitle, {
        x: 0.5, y: 3.6, w: 12.33, h: 0.8,
        fontSize: 18, fontFace: theme.bodyFont,
        color: theme.titleText,
        align: "center", valign: "top",
      });
    }
    if (showSlideNumbers) {
      titleSlide.slideNumber = { x: 12.0, y: 7.0, fontFace: theme.bodyFont, fontSize: 10, color: theme.titleText };
    }

    // -------------------------------------------------------------------
    // Content slides
    // -------------------------------------------------------------------
    let totalImages = 0;
    const allWarnings: string[] = [];

    for (const slide of slides) {
      const s = pptx.addSlide();
      const layout = (slide.layout ?? "text").toLowerCase();

      // Apply background color from theme (unless slide has a background image)
      if (theme.backgroundColor !== "FFFFFF") {
        s.background = { color: theme.backgroundColor };
      }

      // Resolve background image if provided
      if (slide.backgroundImage) {
        const { resolved: bgImages, warnings: bgWarn } = await resolveSlideImages(
          toolCtx.ctx,
          [slide.backgroundImage],
        );
        allWarnings.push(...bgWarn);
        if (bgImages.length > 0) {
          s.background = { data: bgImages[0].data };
          totalImages++;
        }
      }

      // Slide numbers
      if (showSlideNumbers) {
        s.slideNumber = { x: 12.0, y: 7.0, fontFace: theme.bodyFont, fontSize: 10, color: "888888" };
      }

      // Resolve content images for image-bearing layouts
      const { resolved: images, warnings } = await resolveSlideImages(
        toolCtx.ctx,
        slide.images,
      );
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
            // Fallback to text if no table data
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

    // -------------------------------------------------------------------
    // Export to Blob and store
    // -------------------------------------------------------------------
    const blob = (await pptx.write({ outputType: "blob" })) as Blob;
    const storageId = await toolCtx.ctx.storage.store(blob);

    const safeTitle = sanitizeFilename(title, "presentation");
    const filename = `${safeTitle}.pptx`;

    const siteUrl = process.env.CONVEX_SITE_URL;
    const downloadUrl = siteUrl
      ? `${siteUrl}/download?storageId=${encodeURIComponent(storageId)}&filename=${encodeURIComponent(filename)}`
      : await toolCtx.ctx.storage.getUrl(storageId);

    let message =
      `Presentation generated with ${slides.length + 1} slides` +
      (totalImages > 0 ? ` and ${totalImages} embedded images` : "") +
      `. Present the download link to the user: [${filename}](${downloadUrl})`;

    if (allWarnings.length > 0) {
      message += `\n\nWarnings:\n${allWarnings.join("\n")}`;
    }

    return {
      success: true,
      data: {
        storageId,
        downloadUrl,
        filename,
        slideCount: slides.length + 1,
        imageCount: totalImages,
        markdownLink: `[${filename}](${downloadUrl})`,
        message,
      },
    };
  },
});
