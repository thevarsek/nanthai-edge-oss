export type ProvenanceResolutionStatus =
  | "valid"
  | "missing"
  | "repaired"
  | "unavailable"
  | "forbidden";

export interface ProvenanceLocators {
  documentId?: string;
  versionId?: string;
  filename?: string;
  contentHash?: string;
  storageId?: string;
  driveFileId?: string;
  sourceToolName?: string;
}

export interface ProvenanceRepairPolicy {
  allowToolRevalidation: boolean;
  allowedToolNames: string[];
  maxRepairAttempts: number;
}

export interface ProvenanceRepairInput {
  locators?: ProvenanceLocators;
  repairAttempts?: number;
  policy: ProvenanceRepairPolicy;
  directLookup: (kind: string, id: string) => boolean;
  localRepair: (locators: ProvenanceLocators) => string | null;
}

export function resolveMemoryProvenance(input: ProvenanceRepairInput): {
  status: ProvenanceResolutionStatus;
  repairedId?: string;
  revalidationToolNames?: string[];
  reason: string;
} {
  const locators = input.locators;
  if (!locators) {
    return { status: "unavailable", reason: "memory has no provenance locators" };
  }
  if (locators.documentId && input.directLookup("document", locators.documentId)) {
    return { status: "valid", repairedId: locators.documentId, reason: "documentId resolved directly" };
  }
  if (locators.versionId && input.directLookup("documentVersion", locators.versionId)) {
    return { status: "valid", repairedId: locators.versionId, reason: "versionId resolved directly" };
  }
  if (locators.storageId && input.directLookup("storage", locators.storageId)) {
    return { status: "valid", repairedId: locators.storageId, reason: "storageId resolved directly" };
  }
  const repaired = input.localRepair(locators);
  if (repaired) {
    return { status: "repaired", repairedId: repaired, reason: "local provenance locator repaired the reference" };
  }
  const attempts = input.repairAttempts ?? 0;
  if (!input.policy.allowToolRevalidation) {
    return { status: "forbidden", reason: "tool revalidation is not allowed by policy" };
  }
  if (attempts >= input.policy.maxRepairAttempts) {
    return { status: "unavailable", reason: "tool revalidation attempt limit reached" };
  }
  const toolName = locators.sourceToolName;
  const allowed = toolName && input.policy.allowedToolNames.includes(toolName);
  if (!allowed) {
    return { status: "forbidden", reason: "source tool is not allowed for revalidation" };
  }
  return {
    status: "missing",
    revalidationToolNames: [toolName],
    reason: "reference missing; model may revalidate through the original tool family",
  };
}
