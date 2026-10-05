import { runtimeOfflineSchemaTables } from "./schema_tables_runtime_offline";
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
import { mcpSchemaTables } from "./schema_tables_mcp";
import { collaborationSchemaTables } from "./schema_tables_collaboration";
import { runtimeHostSchemaTables } from "./schema_tables_runtime_host";
import { runtimeRoutingSchemaTables } from "./schema_tables_runtime_routing";
import { runtimePermissionSchemaTables } from "./schema_tables_runtime_permissions";
import { runtimeNativeAgentSchemaTables } from "./schema_tables_runtime_native_agents";
import { externalMcpSchemaTables } from "./schema_tables_external_mcp";

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
  ...externalMcpSchemaTables,
  ...mcpSchemaTables,
  ...presentationSchemaTables,
  ...reportSchemaTables,
  ...catalogSchemaTables,
  ...collaborationSchemaTables,
  ...userSchemaTables,
  ...runtimeSchemaTables,
  ...runtimeHostSchemaTables,
  ...runtimeOfflineSchemaTables,
  ...runtimeNativeAgentSchemaTables,
  ...runtimePermissionSchemaTables,
  ...runtimeRoutingSchemaTables,
  ...searchOrchestrationSchemaTables,
});
