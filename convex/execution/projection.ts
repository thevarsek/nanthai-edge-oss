import type { Doc } from "../_generated/dataModel";

export interface ExecutionProjection {
  runId: string;
  attemptId?: string;
  attemptNumber?: number;
  fence?: number;
  kind: Doc<"executionRuns">["kind"];
  domainType?: string;
  domainId?: string;
  parentRunId?: string;
  state: Doc<"executionRuns">["state"];
  placement: "cloud" | "local";
  executorKind?: Doc<"executionAttempts">["executorKind"];
  runtimeLabel?: string;
  provider?: string;
  modelId?: string;
  phase?: string;
  progress?: number;
  checkpointRef?: string;
  leaseExpiresAt?: number;
  lastEventSequence?: number;
  lastEventType?: Doc<"runEvents">["type"];
  artifactIds?: string[];
  lastEventSummary?: string;
  updatedAt: number;
  cancelAvailable: boolean;
  cancelRequested: boolean;
  needsInput: boolean;
  needsPermission: boolean;
  terminalOutcome?: Doc<"executionRuns">["terminalOutcome"];
  terminalSummary?: string;
}

export function projectExecution(
  run: Doc<"executionRuns">,
  attempt: Doc<"executionAttempts"> | null,
  lastEvent: Doc<"runEvents"> | null,
): ExecutionProjection {
  const isTerminal = ["completed", "failed", "cancelled"].includes(run.state);
  return {
    runId: String(run._id),
    attemptId: attempt ? String(attempt._id) : undefined,
    attemptNumber: attempt?.attemptNumber,
    fence: attempt?.fence,
    kind: run.kind,
    domainType: run.domainType,
    domainId: run.domainId,
    parentRunId: run.parentRunId ? String(run.parentRunId) : undefined,
    state: run.state,
    placement: attempt?.placement ?? run.requestedPlacement,
    executorKind: attempt?.executorKind,
    runtimeLabel: attempt?.runtimeLabel,
    provider: attempt?.provider,
    modelId: attempt?.modelId,
    phase: lastEvent?.phase ?? lastEvent?.type,
    progress: lastEvent?.progress,
    checkpointRef: attempt?.checkpointRef,
    leaseExpiresAt: attempt?.leaseExpiresAt,
    lastEventSequence: lastEvent?.sequence,
    lastEventType: lastEvent?.type,
    artifactIds: lastEvent?.artifactIds,
    lastEventSummary: lastEvent?.summary,
    updatedAt: run.updatedAt,
    cancelAvailable: !isTerminal && run.state !== "cancelling",
    cancelRequested: run.cancelRequestedAt !== undefined,
    needsInput: run.state === "waiting_for_input",
    needsPermission: run.state === "waiting_for_permission",
    terminalOutcome: run.terminalOutcome,
    terminalSummary: run.terminalSummary,
  };
}
