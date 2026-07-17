import { defineSchema } from "convex/server";
import { advisorSchemaTables } from "./schema_tables_advisors";
import { catalogSchemaTables } from "./schema_tables_catalog";
import { coreSchemaTables } from "./schema_tables_core";
import { runtimeSchemaTables } from "./schema_tables_runtime";
import { presentationSchemaTables } from "./schema_tables_presentations";
import { userSchemaTables } from "./schema_tables_user";

// =============================================================================
// NanthAI Edge — Convex Schema
// =============================================================================
// Table names and index definitions are kept identical; only declaration
// placement changed so schema domains are easier to review.
// =============================================================================

export default defineSchema({
  ...advisorSchemaTables,
  ...coreSchemaTables,
  ...presentationSchemaTables,
  ...catalogSchemaTables,
  ...userSchemaTables,
  ...runtimeSchemaTables,
});
