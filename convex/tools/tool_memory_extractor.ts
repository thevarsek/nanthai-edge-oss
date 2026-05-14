import type { Id } from "../_generated/dataModel";

export interface PersistedArtifactRef {
  _id: Id<"toolExecutionArtifacts">;
  toolName: string;
  status: "completed" | "failed" | "deferred" | "pending" | "cancelled";
  resultRaw?: string;
  resultBytes?: number;
  storageId?: Id<"_storage">;
  isError?: boolean;
  privacyClassification:
    | "normal"
    | "oauth_data"
    | "google_data"
    | "document_data"
    | "runtime_file_data"
    | "secret_adjacent";
  contextClass:
    | "operational"
    | "provenance"
    | "recovery"
    | "policy";
}

type PrivacyClassification = PersistedArtifactRef["privacyClassification"];

export interface ToolMemoryDraft {
  kind:
    | "retrieval"
    | "file_generated"
    | "document_read"
    | "workspace_state"
    | "connected_app_state"
    | "decision"
    | "error_summary";
  contextClass:
    | "epistemic"
    | "operational"
    | "provenance"
    | "planning"
    | "recovery";
  promotionPolicy: "transient" | "candidate" | "durable" | "audit_only";
  summary: string;
  structuredPayload?: unknown;
  sourceArtifactIds: Array<Id<"toolExecutionArtifacts">>;
  sourceToolNames: string[];
  privacyClassification: PrivacyClassification;
  confidence: number;
  confidenceSource: "tool" | "model" | "deterministic" | "inferred" | "user_asserted" | "composite";
  confidenceRationale?: string;
  ambiguities?: string[];
  limitations?: string[];
  freshnessClass: "volatile" | "session" | "bounded" | "durable" | "permanent";
  staleAfter?: number;
  requiresRevalidation: boolean;
  provenanceLocators?: Record<string, unknown>;
  revalidationToolNames?: string[];
  expiresAt?: number;
}

const CONNECTED_APP_PREFIXES = [
  "gmail",
  "google",
  "drive",
  "slack",
  "notion",
  "microsoft",
  "outlook",
  "calendar",
  "apple_calendar",
];

const DOCUMENT_TOOL_NAMES = new Set([
  "list_documents",
  "read_document",
  "find_in_document",
  "create_docx",
  "edit_docx",
  "read_docx",
]);

const PRIVACY_RANK: Record<PrivacyClassification, number> = {
  normal: 0,
  document_data: 1,
  runtime_file_data: 2,
  google_data: 3,
  oauth_data: 4,
  secret_adjacent: 5,
};

function mostRestrictivePrivacy(artifacts: PersistedArtifactRef[]): PrivacyClassification {
  return artifacts.reduce<PrivacyClassification>((current, artifact) =>
    PRIVACY_RANK[artifact.privacyClassification] > PRIVACY_RANK[current]
      ? artifact.privacyClassification
      : current, "normal");
}

const GENERATED_FILE_KEYS = new Set([
  "storageId",
  "generatedFileId",
  "filename",
  "mimeType",
]);

function parseJson(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function preview(value: unknown, max = 700): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max)}...[truncated]`;
}

function hasGeneratedFilePayload(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const stack = [value as Record<string, unknown>];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if ([...GENERATED_FILE_KEYS].some((key) => key in current)) return true;
    for (const child of Object.values(current)) {
      if (child && typeof child === "object") {
        stack.push(child as Record<string, unknown>);
      }
    }
  }
  return false;
}

function classifyKind(toolName: string, payload: unknown): ToolMemoryDraft["kind"] {
  if (DOCUMENT_TOOL_NAMES.has(toolName) || toolName.includes("document")) return "document_read";
  if (hasGeneratedFilePayload(payload)) return "file_generated";
  if (toolName.includes("python") || toolName.includes("bash") || toolName.includes("workspace")) {
    return "workspace_state";
  }
  if (CONNECTED_APP_PREFIXES.some((prefix) => toolName.startsWith(prefix) || toolName.includes(prefix))) {
    return "connected_app_state";
  }
  return "retrieval";
}

export function extractToolMemoryDrafts(params: {
  artifacts: PersistedArtifactRef[];
  now?: number;
}): ToolMemoryDraft[] {
  const now = params.now ?? Date.now();
  const drafts: ToolMemoryDraft[] = [];
  for (const artifact of params.artifacts) {
    const payload = parseJson(artifact.resultRaw);
    const toolName = artifact.toolName;
    const summaryPrefix = artifact.isError || artifact.status === "failed"
      ? "Tool error"
      : artifact.status === "deferred"
        ? "Deferred tool state"
        : "Tool result";
    const kind = artifact.isError || artifact.status === "failed"
      ? "error_summary"
      : classifyKind(toolName, payload);
    const promotionPolicy =
      artifact.privacyClassification === "secret_adjacent" ||
      artifact.privacyClassification === "oauth_data"
        ? "audit_only"
        : artifact.status === "failed" || artifact.status === "deferred"
          ? "candidate"
          : kind === "workspace_state" && !hasGeneratedFilePayload(payload)
            ? "transient"
            : "durable";
    if (promotionPolicy === "transient" || promotionPolicy === "audit_only") {
      continue;
    }
    const freshnessClass =
      kind === "connected_app_state"
        ? "bounded"
        : kind === "workspace_state"
          ? "session"
          : kind === "file_generated" || kind === "document_read"
            ? "durable"
            : "bounded";
    const provenanceLocators = extractProvenanceLocators(payload, toolName);
    const hasRevalidatableProvenance = [
      "documentId",
      "versionId",
      "storageId",
      "filename",
      "contentHash",
      "url",
      "externalId",
      "driveFileId",
    ].some((key) => provenanceLocators[key] != null);
    const requiresRevalidation = freshnessClass === "bounded" ||
      artifact.status === "deferred" ||
      hasRevalidatableProvenance;
    drafts.push({
      kind,
      contextClass: artifact.isError ? "recovery" : kind === "retrieval" ? "epistemic" : "operational",
      promotionPolicy,
      summary: `${summaryPrefix} from ${toolName}: ${preview(payload)}`,
      structuredPayload: payload,
      sourceArtifactIds: [artifact._id],
      sourceToolNames: [toolName],
      privacyClassification: mostRestrictivePrivacy([artifact]),
      confidence: artifact.isError ? 0.4 : 0.82,
      confidenceSource: artifact.isError ? "tool" : "tool",
      confidenceRationale: artifact.isError
        ? "The tool itself returned an error payload; preserve for retry/recovery context."
        : "The memory is derived from a successful tool execution payload.",
      limitations: artifact.storageId && !artifact.resultRaw
        ? ["Raw result payload is stored separately and may require rehydration for exact details."]
        : undefined,
      freshnessClass,
      staleAfter: freshnessClass === "bounded" ? now + 24 * 60 * 60 * 1000 : undefined,
      requiresRevalidation,
      provenanceLocators,
      revalidationToolNames: requiresRevalidation ? [toolName] : undefined,
    });
  }
  return drafts;
}

function extractProvenanceLocators(payload: unknown, toolName: string): Record<string, unknown> {
  const locators: Record<string, unknown> = { sourceToolName: toolName };
  if (!payload || typeof payload !== "object") return locators;
  const source = payload as Record<string, unknown>;
  for (const key of [
    "filename",
    "storageId",
    "documentId",
    "versionId",
    "driveFileId",
    "externalId",
    "contentHash",
    "url",
  ]) {
    if (source[key] != null) locators[key] = source[key];
  }
  return locators;
}
