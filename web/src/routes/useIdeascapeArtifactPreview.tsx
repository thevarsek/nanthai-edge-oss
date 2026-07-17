import { useCallback, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";
import type { GeneratedFileForPreview } from "@/components/chat/GeneratedFilesCard";
import { DocumentPreviewPanel, type DocumentPreviewSelection } from "@/components/chat/DocumentPreviewPanel";
import { PresentationArtifactPanel } from "@/components/chat/PresentationArtifactPanel";
import type { IdeascapeArtifact } from "@/components/ideascape/IdeascapeArtifactList";
import { documentAnnotationBelongsToGeneratedFile } from "@/routes/ChatPage.flow";

type IdeascapeGeneratedFile = GeneratedFileForPreview & {
  messageId: string;
};

function fileIdsForMessages(messages: Message[]): Id<"generatedFiles">[] {
  const seen = new Set<string>();
  const result: Id<"generatedFiles">[] = [];
  for (const message of messages) {
    for (const fileId of message.generatedFileIds ?? []) {
      if (seen.has(fileId)) continue;
      seen.add(fileId);
      result.push(fileId);
      if (result.length === 100) return result;
    }
  }
  return result;
}

export function useIdeascapeArtifactPreview(messages: Message[]) {
  const fileIds = useMemo(() => fileIdsForMessages(messages), [messages]);
  const files = useQuery(
    api.chat.queries.getGeneratedFilesByIds,
    fileIds.length > 0 ? { fileIds } : "skip",
  ) as IdeascapeGeneratedFile[] | undefined;
  const [selection, setSelection] = useState<DocumentPreviewSelection | null>(null);
  const messagesById = useMemo(
    () => new Map(messages.map((message) => [String(message._id), message])),
    [messages],
  );

  const artifactsByMessageId = useMemo(() => {
    const grouped = new Map<string, IdeascapeArtifact[]>();
    for (const file of files ?? []) {
      const message = messagesById.get(file.messageId);
      const annotationCount = (message?.documentEditAnnotations ?? []).filter((annotation) =>
        documentAnnotationBelongsToGeneratedFile(annotation, file)
      ).length;
      const artifacts = grouped.get(file.messageId) ?? [];
      artifacts.push({ file, annotationCount });
      grouped.set(file.messageId, artifacts);
    }
    return grouped;
  }, [files, messagesById]);

  const openArtifact = useCallback((message: Message, artifact: IdeascapeArtifact) => {
    const annotations = (message.documentEditAnnotations ?? []).filter((annotation) =>
      documentAnnotationBelongsToGeneratedFile(annotation, artifact.file)
    );
    setSelection({
      messageId: message._id,
      file: artifact.file,
      generatedFileId: artifact.file._id,
      filename: artifact.file.filename,
      mimeType: artifact.file.mimeType,
      sizeBytes: artifact.file.sizeBytes,
      downloadUrl: artifact.file.downloadUrl,
      versionId: artifact.file.documentVersionId,
      annotations,
    });
  }, []);

  const panel = selection?.file?.presentationProjectId ? (
    <PresentationArtifactPanel
      projectId={selection.file.presentationProjectId}
      filename={selection.filename}
      onClose={() => setSelection(null)}
      readOnly
    />
  ) : selection ? (
    <DocumentPreviewPanel selection={selection} onClose={() => setSelection(null)} />
  ) : null;

  return { artifactsByMessageId, openArtifact, panel };
}
