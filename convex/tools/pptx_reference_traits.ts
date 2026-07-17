import JSZip from "jszip";

export interface PptxGeometry {
  kind: "text" | "image" | "shape" | "chart_or_table";
  name?: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  assetPath?: string;
}

export interface PptxSlideVisualTraits {
  slideNumber: number;
  layoutName?: string;
  backgroundColor?: string;
  elements: PptxGeometry[];
}

export interface PptxThemeTraits {
  colors: string[];
  majorFont?: string;
  minorFont?: string;
}

export interface PptxEmbeddedImage {
  path: string;
  filename: string;
  mimeType: string;
  data: Uint8Array;
  slideNumbers: number[];
  placements: PptxGeometry[];
}

export interface PptxReferenceTraits {
  aspectRatio: string;
  slideWidthEmu: number;
  slideHeightEmu: number;
  theme: PptxThemeTraits;
  slides: PptxSlideVisualTraits[];
}

export interface PptxReferenceExtraction {
  traits: PptxReferenceTraits;
  embeddedImages: PptxEmbeddedImage[];
}

type Relationship = { id: string; target: string; type: string };

function xmlAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of raw.matchAll(/([A-Za-z_:][A-Za-z0-9:._-]*)="([^"]*)"/g)) {
    if (match[1]) attributes[match[1]] = match[2] ?? "";
  }
  return attributes;
}

function relationships(xml: string): Relationship[] {
  return [...xml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].map((match) => {
    const attrs = xmlAttributes(match[1] ?? "");
    return { id: attrs.Id ?? "", target: attrs.Target ?? "", type: attrs.Type ?? "" };
  }).filter((relationship) => relationship.id && relationship.target);
}

function normalizeZipPath(basePath: string, target: string): string {
  if (target.startsWith("/")) return target.replace(/^\/+/, "");
  const base = basePath.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") base.pop();
    else base.push(segment);
  }
  return base.join("/");
}

function numberAttribute(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function roundRatio(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 10_000) / 10_000 : 0;
}

function transform(
  xml: string,
  kind: PptxGeometry["kind"],
  slideWidth: number,
  slideHeight: number,
): PptxGeometry | undefined {
  const xfrm = xml.match(/<a:xfrm\b([^>]*)>([\s\S]*?)<\/a:xfrm>/);
  const off = xfrm?.[2]?.match(/<a:off\b([^>]*)\/?\s*>/);
  const ext = xfrm?.[2]?.match(/<a:ext\b([^>]*)\/?\s*>/);
  if (!off || !ext) return undefined;
  const offAttrs = xmlAttributes(off[1] ?? "");
  const extAttrs = xmlAttributes(ext[1] ?? "");
  const xfrmAttrs = xmlAttributes(xfrm?.[1] ?? "");
  const nameMatch = xml.match(/<p:cNvPr\b([^>]*)\/?\s*>/);
  const nameAttrs = xmlAttributes(nameMatch?.[1] ?? "");
  const text = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
    .map((match) => match[1]?.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  const rotation = numberAttribute(xfrmAttrs.rot) / 60_000;
  return {
    kind,
    ...(nameAttrs.name ? { name: nameAttrs.name } : {}),
    ...(text ? { text } : {}),
    x: roundRatio(numberAttribute(offAttrs.x), slideWidth),
    y: roundRatio(numberAttribute(offAttrs.y), slideHeight),
    width: roundRatio(numberAttribute(extAttrs.cx), slideWidth),
    height: roundRatio(numberAttribute(extAttrs.cy), slideHeight),
    ...(rotation ? { rotation } : {}),
  };
}

function themeTraits(xml: string): PptxThemeTraits {
  const colors: string[] = [];
  for (const match of xml.matchAll(/<a:(?:dk\d|lt\d|accent\d|hlink|folHlink)>[\s\S]*?<a:(?:srgbClr|sysClr)\b([^>]*)/g)) {
    const attrs = xmlAttributes(match[1] ?? "");
    const color = (attrs.val ?? attrs.lastClr ?? "").toUpperCase();
    if (/^[0-9A-F]{6}$/.test(color) && !colors.includes(color)) colors.push(color);
  }
  const major = xml.match(/<a:majorFont>[\s\S]*?<a:latin\b([^>]*)/);
  const minor = xml.match(/<a:minorFont>[\s\S]*?<a:latin\b([^>]*)/);
  return {
    colors: colors.slice(0, 12),
    majorFont: xmlAttributes(major?.[1] ?? "").typeface || undefined,
    minorFont: xmlAttributes(minor?.[1] ?? "").typeface || undefined,
  };
}

function mimeTypeForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  return ({
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff",
  } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}

async function slideRelationships(zip: JSZip, slidePath: string): Promise<Relationship[]> {
  const filename = slidePath.split("/").pop() ?? "";
  const relsPath = slidePath.replace(filename, `_rels/${filename}.rels`);
  const file = zip.file(relsPath);
  return file ? relationships(await file.async("string")) : [];
}

export async function extractPptxReferenceTraits(
  zip: JSZip,
  slidePaths: string[],
): Promise<PptxReferenceExtraction> {
  const presentationXml = await zip.file("ppt/presentation.xml")?.async("string") ?? "";
  const sizeAttrs = xmlAttributes(presentationXml.match(/<p:sldSz\b([^>]*)/)?.[1] ?? "");
  const slideWidth = numberAttribute(sizeAttrs.cx) || 12_192_000;
  const slideHeight = numberAttribute(sizeAttrs.cy) || 6_858_000;
  const themePath = Object.keys(zip.files).find((path) => /^ppt\/theme\/theme\d+\.xml$/.test(path));
  const themeXml = themePath ? await zip.file(themePath)?.async("string") ?? "" : "";
  const slides: PptxSlideVisualTraits[] = [];
  const images = new Map<string, Omit<PptxEmbeddedImage, "data">>();

  for (const [index, slidePath] of slidePaths.entries()) {
    const xml = await zip.file(slidePath)?.async("string") ?? "";
    const rels = await slideRelationships(zip, slidePath);
    const byId = new Map(rels.map((relationship) => [relationship.id, relationship]));
    const layoutRel = rels.find((relationship) => relationship.type.includes("slideLayout"));
    const layoutPath = layoutRel ? normalizeZipPath(slidePath, layoutRel.target) : undefined;
    const layoutXml = layoutPath ? await zip.file(layoutPath)?.async("string") ?? "" : "";
    const layoutAttrs = xmlAttributes(layoutXml.match(/<p:sldLayout\b([^>]*)/)?.[1] ?? "");
    const elements: PptxGeometry[] = [];
    for (const block of xml.matchAll(/<p:(sp|pic|graphicFrame)\b[\s\S]*?<\/p:\1>/g)) {
      const tag = block[1] ?? "sp";
      const kind = tag === "pic" ? "image" : tag === "graphicFrame"
        ? "chart_or_table" : /<a:t\b/.test(block[0]) ? "text" : "shape";
      const geometry = transform(block[0], kind, slideWidth, slideHeight);
      if (!geometry) continue;
      if (tag === "pic") {
        const relationshipId = block[0].match(/<a:blip\b[^>]*r:embed="([^"]+)"/)?.[1];
        const imageRel = relationshipId ? byId.get(relationshipId) : undefined;
        if (imageRel?.type.toLowerCase().includes("image")) {
          const assetPath = normalizeZipPath(slidePath, imageRel.target);
          geometry.assetPath = assetPath;
          const existing = images.get(assetPath) ?? {
            path: assetPath,
            filename: assetPath.split("/").pop() ?? `image-${images.size + 1}`,
            mimeType: mimeTypeForPath(assetPath),
            slideNumbers: [],
            placements: [],
          };
          if (!existing.slideNumbers.includes(index + 1)) existing.slideNumbers.push(index + 1);
          existing.placements.push(geometry);
          images.set(assetPath, existing);
        }
      }
      elements.push(geometry);
    }
    const backgroundColor = xml.match(/<p:bg>[\s\S]*?<a:srgbClr\b[^>]*val="([0-9A-Fa-f]{6})"/)?.[1];
    slides.push({
      slideNumber: index + 1,
      ...(layoutAttrs.matchingName || layoutAttrs.name
        ? { layoutName: layoutAttrs.matchingName || layoutAttrs.name }
        : {}),
      ...(backgroundColor ? { backgroundColor: backgroundColor.toUpperCase() } : {}),
      elements: elements.slice(0, 60),
    });
  }

  const embeddedImages: PptxEmbeddedImage[] = [];
  for (const image of images.values()) {
    const file = zip.file(image.path);
    if (!file || !image.mimeType.startsWith("image/")) continue;
    embeddedImages.push({ ...image, data: await file.async("uint8array") });
  }
  return {
    traits: {
      aspectRatio: `${Math.round((slideWidth / slideHeight) * 1000) / 1000}:1`,
      slideWidthEmu: slideWidth,
      slideHeightEmu: slideHeight,
      theme: themeTraits(themeXml),
      slides,
    },
    embeddedImages: embeddedImages.slice(0, 24),
  };
}
