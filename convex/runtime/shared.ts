export const RUNTIME_DEFAULT_CWD_ROOT = "/tmp/nanthai-edge";
export const RUNTIME_MAX_CHARTS_PER_TOOL_CALL = 5;
export const RUNTIME_MAX_EXPORTED_FILES_PER_TOOL_CALL = 10;

export interface RuntimeWorkspacePaths {
  root: string;
  inputs: string;
  outputs: string;
  charts: string;
}

export function runtimeWorkspaceCwd(chatId: string): string {
  return `${RUNTIME_DEFAULT_CWD_ROOT}/${chatId}`;
}

export function runtimeWorkspacePaths(chatId: string): RuntimeWorkspacePaths {
  const root = runtimeWorkspaceCwd(chatId);
  return {
    root,
    inputs: `${root}/inputs`,
    outputs: `${root}/outputs`,
    charts: `${root}/charts`,
  };
}

export function isTextLikeMime(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/javascript" ||
    mimeType === "application/xml"
  );
}

export function guessMimeTypeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".py")) return "text/x-python";
  if (lower.endsWith(".ts")) return "text/typescript";
  if (lower.endsWith(".js")) return "text/javascript";
  if (lower.endsWith(".html")) return "text/html";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return "application/octet-stream";
}
