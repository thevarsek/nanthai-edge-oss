// convex/skills/catalog/index.ts
// =============================================================================
// Barrel export for all system skill catalog constants.
//
// Used by `seedSystemCatalog` action to idempotently upsert all curated skills.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

// --- Original skills ---
import { DOC_COAUTHORING_SKILL } from "./doc_coauthoring";
import { DOCUMENTS_SKILL } from "./documents";
import { DOCX_SKILL } from "./docx";
import { INTERNAL_COMMS_SKILL } from "./internal_comms";
import { PDF_SKILL } from "./pdf";
import { PERSISTENT_RUNTIME_SKILL } from "./persistent_runtime";
import { PPTX_SKILL } from "./pptx";
import { XLSX_SKILL } from "./xlsx";
import { APPLE_CALENDAR_SKILL } from "./apple_calendar";
import { CLOZE_SKILL } from "./cloze";
import { CODE_WORKSPACE_SKILL } from "./code_workspace";
import { GMAIL_SKILL } from "./gmail";
import { GOOGLE_CALENDAR_SKILL } from "./google_calendar";
import { GOOGLE_DRIVE_SKILL } from "./google_drive";
import { MICROSOFT_365_SKILL } from "./microsoft_365";
import { NOTION_WORKSPACE_SKILL } from "./notion_workspace";
import { SLACK_SKILL } from "./slack";

// --- GTM skills ---
import { AI_PRICING_SKILL } from "./gtm_ai_pricing";
import { COLD_OUTREACH_SKILL } from "./gtm_cold_outreach";
import { CONTENT_TO_PIPELINE_SKILL } from "./gtm_content_to_pipeline";
import { EXPANSION_RETENTION_SKILL } from "./gtm_expansion_retention";
import { MULTI_PLATFORM_LAUNCH_SKILL } from "./gtm_multi_platform_launch";
import { POSITIONING_ICP_SKILL } from "./gtm_positioning_icp";
import { SEO_SKILL } from "./gtm_seo";
import { SOLO_FOUNDER_GTM_SKILL } from "./gtm_solo_founder";

// --- PM skills ---
import { ADR_SKILL } from "./pm_adr";
import { COMPETITIVE_ANALYSIS_SKILL } from "./pm_competitive_analysis";
import { EXPERIMENT_DESIGN_SKILL } from "./pm_experiment_design";
import { LAUNCH_CHECKLIST_SKILL } from "./pm_launch_checklist";
import { PERSONA_SKILL } from "./pm_persona";
import { PARALLEL_SUBAGENTS_SKILL } from "./parallel_subagents";
import { PRD_SKILL } from "./pm_prd";
import { PROBLEM_STATEMENT_SKILL } from "./pm_problem_statement";
import { RELEASE_NOTES_SKILL } from "./pm_release_notes";
import { RETROSPECTIVE_SKILL } from "./pm_retrospective";
import { USER_STORIES_SKILL } from "./pm_user_stories";

// --- Productivity skills ---
import { BRAINSTORMING_SKILL } from "./prod_brainstorming";
import { CALENDAR_SCHEDULER_SKILL } from "./prod_calendar_scheduler";
import { DATA_ANALYZER_SKILL } from "./prod_data_analyzer";
import { EMAIL_DRAFTER_SKILL } from "./prod_email_drafter";
import { MEETING_NOTES_SKILL } from "./prod_meeting_notes";
import { SCHEDULED_JOBS_SKILL } from "./scheduled_jobs";
import { PERSONA_MANAGER_SKILL } from "./persona_manager";

// --- Design skills ---
import { DESIGN_CRITIQUE_SKILL } from "./design_critique";
import { UX_COPY_SKILL } from "./design_ux_copy";

// --- Data / Analytics skills (MAX-only sandbox) ---
import { DASHBOARD_BUILDER_SKILL } from "./data_dashboard_builder";
import { DATA_VALIDATION_SKILL } from "./data_validation";
import { SQL_DATA_QUERY_SKILL } from "./data_sql_query";
import { STATISTICAL_ANALYSIS_SKILL } from "./data_statistical_analysis";

// --- Engineering skills ---
import { INCIDENT_RESPONSE_SKILL } from "./eng_incident_response";
import { TESTING_STRATEGY_SKILL } from "./eng_testing_strategy";

// --- Finance skills ---
import { FINANCIAL_STATEMENTS_SKILL } from "./finance_statements";
import { RECONCILIATION_SKILL } from "./finance_reconciliation";

// --- Legal skills ---
import { CONTRACT_REVIEW_SKILL } from "./legal_contract_review";

// --- Marketing skills ---
import { CAMPAIGN_PLANNING_SKILL } from "./mktg_campaign_planning";
import { EMAIL_SEQUENCE_SKILL } from "./mktg_email_sequence";
import { MARKETING_PERFORMANCE_REPORT_SKILL } from "./mktg_performance_report";

// --- Ops skills ---
import { PROCESS_DOC_SKILL } from "./ops_process_doc";

// --- PM skills (new) ---
import { SPRINT_PLANNING_SKILL } from "./pm_sprint_planning";

// --- Hidden skills ---
import { NANTHAI_MOBILE_RUNTIME_SKILL } from "./nanthai_mobile_runtime";
import { CREATE_SKILL_SKILL } from "./create_skill";

/**
 * All system skills to seed into the database.
 *
 * Order: visible skills first (alphabetical by slug), then hidden skills.
 */
export const SYSTEM_SKILL_CATALOG: SystemSkillSeedData[] = [
  // Visible skills (shown in catalog XML) — alphabetical by slug
  ADR_SKILL,
  AI_PRICING_SKILL,
  APPLE_CALENDAR_SKILL,
  BRAINSTORMING_SKILL,
  CALENDAR_SCHEDULER_SKILL,
  CAMPAIGN_PLANNING_SKILL,
  CLOZE_SKILL,
  CODE_WORKSPACE_SKILL,
  COLD_OUTREACH_SKILL,
  COMPETITIVE_ANALYSIS_SKILL,
  CONTENT_TO_PIPELINE_SKILL,
  CONTRACT_REVIEW_SKILL,
  CREATE_SKILL_SKILL,
  DASHBOARD_BUILDER_SKILL,
  DATA_ANALYZER_SKILL,
  DATA_VALIDATION_SKILL,
  DESIGN_CRITIQUE_SKILL,
  DOC_COAUTHORING_SKILL,
  DOCUMENTS_SKILL,
  DOCX_SKILL,
  EMAIL_DRAFTER_SKILL,
  EMAIL_SEQUENCE_SKILL,
  EXPANSION_RETENTION_SKILL,
  EXPERIMENT_DESIGN_SKILL,
  FINANCIAL_STATEMENTS_SKILL,
  GMAIL_SKILL,
  GOOGLE_CALENDAR_SKILL,
  GOOGLE_DRIVE_SKILL,
  INCIDENT_RESPONSE_SKILL,
  INTERNAL_COMMS_SKILL,
  LAUNCH_CHECKLIST_SKILL,
  MARKETING_PERFORMANCE_REPORT_SKILL,
  MEETING_NOTES_SKILL,
  MICROSOFT_365_SKILL,
  MULTI_PLATFORM_LAUNCH_SKILL,
  NOTION_WORKSPACE_SKILL,
  PDF_SKILL,
  PARALLEL_SUBAGENTS_SKILL,
  PERSONA_MANAGER_SKILL,
  PERSONA_SKILL,
  PERSISTENT_RUNTIME_SKILL,
  POSITIONING_ICP_SKILL,
  PPTX_SKILL,
  PRD_SKILL,
  PROBLEM_STATEMENT_SKILL,
  PROCESS_DOC_SKILL,
  RECONCILIATION_SKILL,
  RELEASE_NOTES_SKILL,
  RETROSPECTIVE_SKILL,
  SCHEDULED_JOBS_SKILL,
  SEO_SKILL,
  SLACK_SKILL,
  SOLO_FOUNDER_GTM_SKILL,
  SPRINT_PLANNING_SKILL,
  SQL_DATA_QUERY_SKILL,
  STATISTICAL_ANALYSIS_SKILL,
  TESTING_STRATEGY_SKILL,
  USER_STORIES_SKILL,
  UX_COPY_SKILL,
  XLSX_SKILL,
  // Hidden skills (not in catalog XML, loaded separately)
  NANTHAI_MOBILE_RUNTIME_SKILL,
];
