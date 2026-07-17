declare module "dom-to-pptx" {
  export type DomToPptxTarget = HTMLElement | string;

  export interface DomToPptxFont {
    name: string;
    url?: string;
    urls?: string[];
    weight?: number | string;
    style?: string;
  }

  export interface DomToPptxOptions {
    fileName?: string;
    skipDownload?: boolean;
    autoEmbedFonts?: boolean;
    fonts?: DomToPptxFont[];
    svgAsVector?: boolean;
    layout?: "LAYOUT_WIDE" | "LAYOUT_16x10" | "LAYOUT_4x3";
    width?: number;
    height?: number;
    skipNormalize?: boolean;
  }

  export function exportToPptx(
    target: DomToPptxTarget | DomToPptxTarget[],
    options?: DomToPptxOptions,
  ): Promise<Blob>;
}
