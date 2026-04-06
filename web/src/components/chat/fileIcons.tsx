import {
  File,
  FileArchive,
  FileAudio2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo2,
  Presentation,
} from "lucide-react";

export function getFileIconComponent(mimeType?: string | null) {
  const normalized = mimeType?.toLowerCase() ?? "";
  if (normalized.startsWith("image/")) return FileImage;
  if (normalized.startsWith("audio/")) return FileAudio2;
  if (normalized.startsWith("video/")) return FileVideo2;
  if (
    normalized.includes("pdf") ||
    normalized.includes("text") ||
    normalized.includes("word") ||
    normalized.includes("document")
  ) {
    return FileText;
  }
  if (
    normalized.includes("sheet") ||
    normalized.includes("excel") ||
    normalized.includes("csv")
  ) {
    return FileSpreadsheet;
  }
  if (
    normalized.includes("presentation") ||
    normalized.includes("powerpoint")
  ) {
    return Presentation;
  }
  if (
    normalized.includes("zip") ||
    normalized.includes("compressed") ||
    normalized.includes("archive")
  ) {
    return FileArchive;
  }
  return File;
}
