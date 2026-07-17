import { useAction, useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { presentationExporter } from "@/lib/presentations";
import { PPTX_MIME_TYPE } from "@/lib/presentations/presentationExportFile";
import { renderSlidesForExport } from "@/lib/presentations/renderExportSlides";
import type {
  PresentationAssetUrls,
  PresentationSlideRecord,
} from "@/lib/presentations/types";

interface PresentationSnapshotSyncOptions {
  projectId: string;
  projectRevision?: number;
  snapshotRevision?: number;
  snapshotKind?: "fallback" | "browser_html";
  slides: PresentationSlideRecord[];
  assetUrls: PresentationAssetUrls;
  filename: string;
  enabled: boolean;
  onError: (error: unknown) => void;
}

export function usePresentationSnapshotSync({
  projectId,
  projectRevision,
  snapshotRevision,
  snapshotKind,
  slides,
  assetUrls,
  filename,
  enabled,
  onError,
}: PresentationSnapshotSyncOptions) {
  const createUploadUrl = useMutation(api.chat.mutations.createUploadUrl);
  const persistSnapshot = useAction(api.presentations.actions.persistSnapshot);
  const [isSyncing, setIsSyncing] = useState(false);
  const inFlightKeyRef = useRef<string | null>(null);
  const failedKeyRef = useRef<string | null>(null);

  const sync = useCallback(async () => {
    if (projectRevision === undefined || slides.length === 0) return;
    const key = `${projectId}:${projectRevision}`;
    if (inFlightKeyRef.current) return;
    inFlightKeyRef.current = key;
    setIsSyncing(true);
    let rendered: Awaited<ReturnType<typeof renderSlidesForExport>> | undefined;
    try {
      rendered = await renderSlidesForExport(slides, document, assetUrls);
      const exported = await presentationExporter.exportPresentation({
        slideRoots: rendered.roots,
        suggestedFileName: filename,
      });
      const uploadUrl = await createUploadUrl({});
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": PPTX_MIME_TYPE },
        body: exported.blob,
      });
      if (!response.ok) throw new Error("The current PowerPoint snapshot could not be uploaded.");
      const uploaded = await response.json() as { storageId?: string };
      if (!uploaded.storageId) throw new Error("The snapshot upload returned no storage ID.");
      await persistSnapshot({
        projectId: projectId as Id<"presentationProjects">,
        expectedRevision: projectRevision,
        storageId: uploaded.storageId as Id<"_storage">,
        sizeBytes: exported.blob.size,
      });
      failedKeyRef.current = null;
    } catch (error) {
      failedKeyRef.current = key;
      onError(error);
    } finally {
      rendered?.cleanup();
      if (inFlightKeyRef.current === key) inFlightKeyRef.current = null;
      setIsSyncing(false);
    }
  }, [assetUrls, createUploadUrl, filename, onError, persistSnapshot, projectId, projectRevision, slides]);

  useEffect(() => {
    if (!enabled || isSyncing || projectRevision === undefined) return;
    const key = `${projectId}:${projectRevision}`;
    const isCurrent = snapshotKind === "browser_html" && snapshotRevision === projectRevision;
    if (isCurrent || failedKeyRef.current === key || inFlightKeyRef.current === key) return;
    const timeout = window.setTimeout(() => void sync(), 250);
    return () => window.clearTimeout(timeout);
  }, [enabled, isSyncing, projectId, projectRevision, snapshotKind, snapshotRevision, sync]);

  return { isSyncing, syncNow: sync };
}
