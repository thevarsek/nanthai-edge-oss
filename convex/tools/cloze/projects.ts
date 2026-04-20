// convex/tools/cloze/projects.ts
// =============================================================================
// Cloze project tools: find and change.
//
// Maps to:
//   GET  /v1/projects/find   — cloze_project_find
//   POST /v1/projects/update — cloze_project_change
// =============================================================================

import { createTool } from "../registry";
import { getClozeAccessToken } from "./auth";
import { clozeFetch } from "./client";

// ---------------------------------------------------------------------------
// cloze_project_find
// ---------------------------------------------------------------------------

export const clozeProjectFind = createTool({
  name: "cloze_project_find",
  description:
    "Search for projects / deals in the user's Cloze CRM. " +
    "Supports free-text queries, stage/segment/step filtering, " +
    "pagination, and sorting. Returns matching project records.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Free-text search query.",
      },
      stage: {
        type: "string",
        description: "Filter by project stage: future, current, won, lost, none, any.",
      },
      segment: {
        type: "string",
        description: "Filter by segment key or name.",
      },
      step: {
        type: "string",
        description: "Filter by step key, or 'none'/'any'.",
      },
      assignee: {
        type: "string",
        description: "Filter by assignee email.",
      },
      collaborator: {
        type: "string",
        description: "Filter by deal-team collaborator email.",
      },
      scope: {
        type: "string",
        description: "Scope: 'local', 'team', or 'hierarchy:/X/Y/Z'.",
      },
      sort: {
        type: "string",
        description:
          "Sort order: lastchanged, name, value, created, start, end, " +
          "duenext, duepast, nextstep, assigned, etc.",
      },
      hide_lost_done: {
        type: "boolean",
        description: "Hide lost/done projects (default false).",
      },
      page_size: {
        type: "number",
        description: "Results per page (default 10, max 100).",
      },
      page_number: {
        type: "number",
        description: "Page number starting from 1.",
      },
    },
    required: [],
  },

  execute: async (toolCtx, args) => {
    try {
      const { accessToken } = await getClozeAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      const params = new URLSearchParams();
      if (args.query) params.set("freeformquery", String(args.query));
      if (args.stage) params.set("stage", String(args.stage));
      if (args.segment) params.set("segment", String(args.segment));
      if (args.step) params.set("step", String(args.step));
      if (args.assignee) params.set("assignee", String(args.assignee));
      if (args.collaborator) params.set("collaborator", String(args.collaborator));
      if (args.scope) params.set("scope", String(args.scope));
      if (args.sort) params.set("sort", String(args.sort));
      if (args.hide_lost_done) params.set("hidelostdone", "true");
      params.set(
        "pagesize",
        String(Math.min(Number(args.page_size) || 10, 100)),
      );
      params.set("pagenumber", String(Number(args.page_number) || 1));

      const response = await clozeFetch(
        toolCtx,
        `/projects/find?${params}`,
        accessToken,
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          success: false,
          data: null,
          error: `Cloze project find failed (HTTP ${response.status}): ${text.slice(0, 500)}`,
        };
      }

      const result = (await response.json()) as {
        errorcode: number;
        availablecount?: number;
        pagenumber?: number;
        pagesize?: number;
        projects?: unknown[];
        message?: string;
      };

      if (result.errorcode !== 0) {
        return {
          success: false,
          data: null,
          error: `Cloze error ${result.errorcode}: ${result.message ?? "Unknown error"}`,
        };
      }

      return {
        success: true,
        data: {
          total: result.availablecount ?? 0,
          page: result.pagenumber ?? 1,
          pageSize: result.pagesize ?? 10,
          projects: result.projects ?? [],
        },
        error: undefined,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: `Cloze project find error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

// ---------------------------------------------------------------------------
// cloze_project_change
// ---------------------------------------------------------------------------

export const clozeProjectChange = createTool({
  name: "cloze_project_change",
  description:
    "Update an existing project / deal in Cloze. Provide the project name " +
    "(or app link) for matching, plus the fields to change. " +
    "Fields are merged into the existing project record.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Project name (used for matching). Required unless app_links provided.",
      },
      summary: {
        type: "string",
        description: "Project description / summary.",
      },
      stage: {
        type: "string",
        description: "New stage: future, current, won, lost.",
      },
      segment: {
        type: "string",
        description: "Segment key or name.",
      },
      step: {
        type: "string",
        description: "Step key.",
      },
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "Tags / keywords.",
      },
      notes: {
        type: "string",
        description: "About notes.",
      },
      at_a_glance_notes: {
        type: "string",
        description: "At-a-glance notes.",
      },
      start_date: {
        type: "string",
        description: "Project start date (ISO format).",
      },
      end_date: {
        type: "string",
        description: "Project end date (ISO format).",
      },
      project_team: {
        type: "array",
        items: { type: "string" },
        description: "Collaborator email addresses.",
      },
      custom_fields: {
        type: "array",
        items: { type: "object" },
        description: "Custom fields to set.",
      },
      app_links: {
        type: "array",
        items: { type: "object" },
        description:
          'External app links for matching: [{"source":"mycrm.com","uniqueid":"123"}].',
      },
    },
    required: [],
  },

  execute: async (toolCtx, args) => {
    try {
      const { accessToken } = await getClozeAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      const body: Record<string, unknown> = {};
      if (args.name) body.name = String(args.name);
      if (args.summary) body.summary = String(args.summary);
      if (args.stage) body.stage = String(args.stage);
      if (args.segment) body.segment = String(args.segment);
      if (args.step) body.step = String(args.step);
      if (args.keywords) body.keywords = args.keywords;
      if (args.notes) body.notes = String(args.notes);
      if (args.at_a_glance_notes)
        body.atAGlanceNotes = String(args.at_a_glance_notes);
      if (args.start_date) body.startDate = String(args.start_date);
      if (args.end_date) body.endDate = String(args.end_date);
      if (args.project_team) body.projectTeam = args.project_team;
      if (args.custom_fields) body.customFields = args.custom_fields;
      if (args.app_links) body.appLinks = args.app_links;

      const response = await clozeFetch(
        toolCtx,
        "/projects/update",
        accessToken,
        { method: "POST", body: JSON.stringify(body) },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          success: false,
          data: null,
          error: `Cloze project change failed (HTTP ${response.status}): ${text.slice(0, 500)}`,
        };
      }

      const result = (await response.json()) as {
        errorcode: number;
        message?: string;
      };

      if (result.errorcode !== 0) {
        return {
          success: false,
          data: null,
          error: `Cloze error ${result.errorcode}: ${result.message ?? "Unknown error"}`,
        };
      }

      return {
        success: true,
        data: { message: "Project updated in Cloze." },
        error: undefined,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: `Cloze project change error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
