import { FileText, Presentation } from "lucide-react";
import type { GeneratedFileForPreview } from "@/components/chat/GeneratedFilesCard";

export type IdeascapeArtifact = {
  file: GeneratedFileForPreview;
  annotationCount: number;
};

function artifactLabel(artifact: IdeascapeArtifact): string {
  if (artifact.file.presentationProjectId) return "Presentation";
  if (
    artifact.file.mimeType.includes("wordprocessingml") ||
    artifact.file.filename.toLowerCase().endsWith(".docx")
  ) {
    return artifact.annotationCount > 0
      ? `Word document · ${artifact.annotationCount} tracked ${artifact.annotationCount === 1 ? "change" : "changes"}`
      : "Word document";
  }
  return "Generated file";
}

export function IdeascapeArtifactList({
  artifacts,
  onOpen,
}: {
  artifacts: IdeascapeArtifact[];
  onOpen: (artifact: IdeascapeArtifact) => void;
}) {
  if (artifacts.length === 0) return null;
  const visible = artifacts.slice(0, 2);
  return (
    <div className="space-y-1.5" data-testid="ideascape-artifacts">
      {visible.map((artifact) => {
        const Icon = artifact.file.presentationProjectId ? Presentation : FileText;
        return (
          <button
            key={artifact.file._id}
            type="button"
            className="flex w-full items-center gap-2 rounded-lg border border-border/45 bg-surface-2/75 px-2.5 py-2 text-left transition-colors hover:border-primary/35 hover:bg-surface-3"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(artifact);
            }}
            title={`Open ${artifact.file.filename}`}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Icon size={14} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold text-foreground">
                {artifact.file.filename}
              </span>
              <span className="block truncate text-[9px] text-muted">
                {artifactLabel(artifact)} · Open preview
              </span>
            </span>
          </button>
        );
      })}
      {artifacts.length > visible.length && (
        <p className="px-1 text-[9px] font-medium text-muted">
          +{artifacts.length - visible.length} more {artifacts.length - visible.length === 1 ? "file" : "files"}
        </p>
      )}
    </div>
  );
}
