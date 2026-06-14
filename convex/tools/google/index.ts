// convex/tools/google/index.ts
// =============================================================================
// Barrel export for all Google Workspace tools.
// =============================================================================

export { gmailSend, gmailCreateDraft, gmailRead, gmailSearch, gmailDelete, gmailModifyLabels, gmailListLabels } from "./gmail_proxy";
export { driveUpload, driveList, driveRead, driveMove, calendarList, calendarCreate, calendarDelete } from "./proxy";
