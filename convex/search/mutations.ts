// convex/search/mutations.ts
// =============================================================================
// Stable search mutation registrations.
// Keep exported function IDs here; implementation is extracted to helpers.
// =============================================================================

export {
  updateSearchSession,
  patchMessageSearchContext,
  writeSearchPhase,
  cleanStaleSearchPhases,
} from "./mutations_internal";
export { startResearchPaper, cancelResearchPaper } from "./mutations_research_paper";
export { regeneratePaper } from "./mutations_regenerate";
export { repairInvalidMessagePersonas } from "./migrations";
