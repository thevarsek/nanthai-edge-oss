import type { EligibleWork } from "./work_review_policy";
import type { CollaborationSelection } from "./validators";

export function selectedWork(candidates: EligibleWork[], selection: CollaborationSelection) {
  return candidates.find(row => (selection.workId ? row._id === selection.workId :
    selection.reasonCode === "owned_work" || selection.reasonCode === "review_work")
    && (row.status === "review" ? row.pendingReviewerIds.includes(selection.participantId)
      : row.status === "open" && (!row.assigneeId || row.assigneeId === selection.participantId)));
}
