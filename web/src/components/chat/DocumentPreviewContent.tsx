import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Message } from "@/hooks/useChat";

type DocumentEditAnnotation = NonNullable<Message["documentEditAnnotations"]>[number];

export type DocumentPreviewTextSegment = {
  kind: "normal" | "inserted" | "deleted";
  text: string;
};

export type DocumentPreviewPayload = {
  kind: "docx" | "text" | "unsupported";
  versionId: string;
  filename: string;
  mimeType: string;
  paragraphs: Array<{
    style: string;
    segments: DocumentPreviewTextSegment[];
  }>;
  wordCount?: number;
};

function paragraphClass(style: string): string {
  if (style === "Title") return "mb-5 text-center text-lg font-semibold";
  if (style === "Heading1") return "mb-3 mt-5 text-base font-semibold";
  if (style === "Heading2") return "mb-2 mt-4 text-sm font-semibold";
  if (style.startsWith("Heading")) return "mb-2 mt-3 text-sm font-semibold";
  if (style.startsWith("List")) return "mb-1 ml-4 text-sm leading-6";
  return "mb-3 text-sm leading-6";
}

function segmentClass(kind: DocumentPreviewTextSegment["kind"]): string {
  switch (kind) {
  case "deleted":
    return "rounded-sm bg-red-100 px-0.5 text-red-800 line-through decoration-red-700";
  case "inserted":
    return "rounded-sm bg-emerald-100 px-0.5 text-emerald-900 underline decoration-emerald-700";
  default:
    return "";
  }
}

function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

type ParagraphAnnotationMatch = "typed" | "fallback";

function segmentText(
  paragraph: DocumentPreviewPayload["paragraphs"][number],
  kind: DocumentPreviewTextSegment["kind"],
): string {
  return normalizeForMatch(
    paragraph.segments
      .filter((segment) => segment.kind === kind)
      .map((segment) => segment.text)
      .join(""),
  );
}

function paragraphAnnotationMatch(
  paragraph: DocumentPreviewPayload["paragraphs"][number],
  annotation?: DocumentEditAnnotation,
): ParagraphAnnotationMatch | null {
  if (!annotation) return null;
  const deleted = normalizeForMatch(annotation.deletedText);
  const inserted = normalizeForMatch(annotation.insertedText);
  const deletedSegmentText = segmentText(paragraph, "deleted");
  const insertedSegmentText = segmentText(paragraph, "inserted");
  if (
    (deleted && deletedSegmentText.includes(deleted)) ||
    (inserted && insertedSegmentText.includes(inserted))
  ) {
    return "typed";
  }

  const paragraphText = normalizeForMatch(paragraph.segments.map((segment) => segment.text).join(""));
  if ((deleted && paragraphText.includes(deleted)) || (inserted && paragraphText.includes(inserted))) {
    return "fallback";
  }
  return null;
}

function focusedParagraphIndexes(
  paragraphs: DocumentPreviewPayload["paragraphs"],
  annotation?: DocumentEditAnnotation,
): Set<number> {
  const typedMatches: number[] = [];
  const fallbackMatches: number[] = [];
  paragraphs.forEach((paragraph, index) => {
    const match = paragraphAnnotationMatch(paragraph, annotation);
    if (match === "typed") typedMatches.push(index);
    if (match === "fallback") fallbackMatches.push(index);
  });
  return new Set(typedMatches.length > 0 ? typedMatches : fallbackMatches);
}

export function DocumentPreviewContent({
  preview,
  focusedAnnotation,
}: {
  preview: DocumentPreviewPayload;
  focusedAnnotation?: DocumentEditAnnotation;
}) {
  const { t } = useTranslation();
  const paragraphRefs = useRef(new Map<number, HTMLParagraphElement>());
  const focusedIndexes = useMemo(
    () => focusedParagraphIndexes(preview.paragraphs, focusedAnnotation),
    [focusedAnnotation, preview.paragraphs],
  );

  useEffect(() => {
    const index = focusedIndexes.values().next().value;
    if (index == null) return;
    window.setTimeout(() => {
      paragraphRefs.current.get(index)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  }, [focusedIndexes]);

  if (preview.kind === "unsupported") {
    return (
      <div className="rounded-lg border border-border/50 bg-surface-2/40 px-4 py-5 text-sm text-muted">
        {t("no_inline_preview_available")}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/50 bg-white px-6 py-7 text-neutral-950 shadow-sm">
      {preview.paragraphs.map((paragraph, index) => {
        const focused = focusedIndexes.has(index);
        return (
          <p
            key={`${paragraph.style}-${index}`}
            ref={(node) => {
              if (node) paragraphRefs.current.set(index, node);
              else paragraphRefs.current.delete(index);
            }}
            className={`${paragraphClass(paragraph.style)} ${
              focused ? "rounded-md bg-amber-100/70 px-2 py-1 ring-1 ring-amber-300" : ""
            }`}
          >
            {paragraph.segments.map((segment, segmentIndex) => (
              <span
                key={`${index}-${segmentIndex}`}
                className={`whitespace-pre-wrap ${segmentClass(segment.kind)}`}
              >
                {segment.text}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
