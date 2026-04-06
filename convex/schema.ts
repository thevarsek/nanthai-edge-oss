import { defineSchema } from "convex/server";
import { catalogSchemaTables } from "./schema_tables_catalog";
import { coreSchemaTables } from "./schema_tables_core";
import { runtimeSchemaTables } from "./schema_tables_runtime";
import { userSchemaTables } from "./schema_tables_user";

// =============================================================================
// NanthAI Edge — Convex Schema
// =============================================================================
// Table names and index definitions are kept identical; only declaration
// placement changed so schema domains are easier to review.
// =============================================================================

export default defineSchema({
  ...coreSchemaTables,
  ...catalogSchemaTables,
  ...userSchemaTables,
  ...runtimeSchemaTables,
});
