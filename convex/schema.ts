import { defineSchema } from "convex/server";
import { advisorSchemaTables } from "./schema_tables_advisors";
import { catalogSchemaTables } from "./schema_tables_catalog";
import { coreSchemaTables } from "./schema_tables_core";
import { executionSchemaTables } from "./schema_tables_execution";
import { runtimeSchemaTables } from "./schema_tables_runtime";
import { presentationSchemaTables } from "./schema_tables_presentations";
import { userSchemaTables } from "./schema_tables_user";
import { searchOrchestrationSchemaTables } from "./schema_tables_search";
import { analyticsSchemaTables } from "./schema_tables_analytics";
import { reportSchemaTables } from "./schema_tables_reports";

// =============================================================================
// NanthAI Edge — Convex Schema
// =============================================================================
// Table names and index definitions are kept identical; only declaration
// placement changed so schema domains are easier to review.
// =============================================================================

export default defineSchema({
  ...advisorSchemaTables,
  ...analyticsSchemaTables,
  ...coreSchemaTables,
  ...executionSchemaTables,
  ...presentationSchemaTables,
  ...reportSchemaTables,
  ...catalogSchemaTables,
  ...userSchemaTables,
  ...runtimeSchemaTables,
  ...searchOrchestrationSchemaTables,
});
