// convex/tools/cloze/people.ts
// =============================================================================
// Cloze people tools: find, add, change, count.
//
// Maps to:
//   GET  /v1/people/find   — cloze_person_find, cloze_person_count
//   POST /v1/people/create — cloze_person_add
//   POST /v1/people/update — cloze_person_change
// =============================================================================

import { createTool } from "../registry";
import { getClozeAccessToken } from "./auth";
import { clozeFetch } from "./client";

// ---------------------------------------------------------------------------
// cloze_person_find
// ---------------------------------------------------------------------------

export const clozePersonFind = createTool({
  name: "cloze_person_find",
  description:
    "Search for people in the user's Cloze CRM. " +
    "Supports free-text queries, stage/segment/step filtering, pagination, " +
    "and sorting. Returns matching person records with names, emails, phones, " +
    "stages, segments, and custom fields.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Free-text search query (same as the Cloze search bar). " +
          "Searches names, emails, phones, companies, notes.",
      },
      stage: {
        type: "string",
        description:
          "Filter by relationship stage: lead, future, current, past, out, none, any.",
      },
      segment: {
        type: "string",
        description: "Filter by segment key or name (e.g. 'customer', 'partner').",
      },
      step: {
        type: "string",
        description: "Filter by step key, or 'none'/'any'.",
      },
      assignee: {
        type: "string",
        description: "Filter by assignee email address.",
      },
      sort: {
        type: "string",
        description:
          "Sort order: lastchanged, bestrelationship, firstmet, lasttalked, " +
          "wentquiet, assigned, duenext, duepast, first, last, nextstep, " +
          "distance, value, created, start, end, name.",
      },
      scope: {
        type: "string",
        description: "Scope: 'local' (your contacts), 'team', or 'hierarchy:/X/Y/Z'.",
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
      if (args.sort) params.set("sort", String(args.sort));
      if (args.scope) params.set("scope", String(args.scope));
      params.set(
        "pagesize",
        String(Math.min(Number(args.page_size) || 10, 100)),
      );
      params.set("pagenumber", String(Number(args.page_number) || 1));

      const response = await clozeFetch(
        toolCtx,
        `/people/find?${params}`,
        accessToken,
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          success: false,
          data: null,
          error: `Cloze people find failed (HTTP ${response.status}): ${text.slice(0, 500)}`,
        };
      }

      const result = (await response.json()) as {
        errorcode: number;
        availablecount?: number;
        pagenumber?: number;
        pagesize?: number;
        people?: unknown[];
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
          people: result.people ?? [],
        },
        error: undefined,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: `Cloze person find error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

// ---------------------------------------------------------------------------
// cloze_person_count
// ---------------------------------------------------------------------------

export const clozePersonCount = createTool({
  name: "cloze_person_count",
  description:
    "Count people in the user's Cloze CRM matching given criteria. " +
    "Faster than a full search when you only need the total. " +
    "Supports the same filters as cloze_person_find.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Free-text search query.",
      },
      stage: {
        type: "string",
        description: "Filter by stage: lead, future, current, past, out, none, any.",
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
      scope: {
        type: "string",
        description: "Scope: 'local', 'team', or 'hierarchy:/X/Y/Z'.",
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

      const params = new URLSearchParams({ countonly: "true" });
      if (args.query) params.set("freeformquery", String(args.query));
      if (args.stage) params.set("stage", String(args.stage));
      if (args.segment) params.set("segment", String(args.segment));
      if (args.step) params.set("step", String(args.step));
      if (args.assignee) params.set("assignee", String(args.assignee));
      if (args.scope) params.set("scope", String(args.scope));

      const response = await clozeFetch(
        toolCtx,
        `/people/find?${params}`,
        accessToken,
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          success: false,
          data: null,
          error: `Cloze people count failed (HTTP ${response.status}): ${text.slice(0, 500)}`,
        };
      }

      const result = (await response.json()) as {
        errorcode: number;
        availablecount?: number;
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
        data: { count: result.availablecount ?? 0 },
        error: undefined,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: `Cloze person count error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

// ---------------------------------------------------------------------------
// cloze_person_add
// ---------------------------------------------------------------------------

export const clozePersonAdd = createTool({
  name: "cloze_person_add",
  description:
    "Add a new person to the user's Cloze CRM. " +
    "Provide at least a name or email. Can include phone numbers, " +
    "stage, segment, keywords, custom fields, notes, and more.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Full name." },
      first: { type: "string", description: "First name." },
      last: { type: "string", description: "Last name." },
      emails: {
        type: "array",
        items: { type: "object" },
        description:
          'Array of email objects: [{"value":"a@b.com","work":true}]. ' +
          "Flags: work, home, preferred (booleans).",
      },
      phones: {
        type: "array",
        items: { type: "object" },
        description:
          'Array of phone objects: [{"value":"+15551234","mobile":true}]. ' +
          "Flags: work, home, mobile (booleans).",
      },
      stage: {
        type: "string",
        description: "Relationship stage: lead, future, current, past, out.",
      },
      segment: { type: "string", description: "Segment key or name." },
      step: { type: "string", description: "Step key." },
      headline: { type: "string", description: "Headline / title." },
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "Tags / keywords.",
      },
      notes: { type: "string", description: "About notes (rich-text or plain)." },
      assign_to: { type: "string", description: "Email of team member to assign." },
      share_to: {
        type: "string",
        description: 'Email to share to, or "team" for whole team.',
      },
      custom_fields: {
        type: "array",
        items: { type: "object" },
        description:
          'Array of custom field objects: [{"id":"field-id","type":"text","value":"val"}].',
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
      if (args.first) body.first = String(args.first);
      if (args.last) body.last = String(args.last);
      if (args.emails) body.emails = args.emails;
      if (args.phones) body.phones = args.phones;
      if (args.stage) body.stage = String(args.stage);
      if (args.segment) body.segment = String(args.segment);
      if (args.step) body.step = String(args.step);
      if (args.headline) body.headline = String(args.headline);
      if (args.keywords) body.keywords = args.keywords;
      if (args.notes) body.notes = String(args.notes);
      if (args.assign_to) body.assignTo = String(args.assign_to);
      if (args.share_to) body.shareTo = String(args.share_to);
      if (args.custom_fields) body.customFields = args.custom_fields;

      const response = await clozeFetch(
        toolCtx,
        "/people/create",
        accessToken,
        { method: "POST", body: JSON.stringify(body) },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          success: false,
          data: null,
          error: `Cloze person add failed (HTTP ${response.status}): ${text.slice(0, 500)}`,
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
        data: { message: "Person added to Cloze." },
        error: undefined,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: `Cloze person add error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

// ---------------------------------------------------------------------------
// cloze_person_change
// ---------------------------------------------------------------------------

export const clozePersonChange = createTool({
  name: "cloze_person_change",
  description:
    "Update an existing person in Cloze. Provide enough identifying info " +
    "(email, phone, or app link) to match, plus the fields to change. " +
    "Provided fields are merged into the existing record.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Full name (used for matching if unique)." },
      emails: {
        type: "array",
        items: { type: "object" },
        description: "Email objects (used for matching + updating).",
      },
      phones: {
        type: "array",
        items: { type: "object" },
        description: "Phone objects (used for matching + updating).",
      },
      stage: { type: "string", description: "New stage: lead, future, current, past, out." },
      segment: { type: "string", description: "New segment key or name." },
      step: { type: "string", description: "New step key." },
      headline: { type: "string", description: "New headline / title." },
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "Tags to set.",
      },
      notes: { type: "string", description: "About notes to set." },
      assign_to: { type: "string", description: "Email of team member to assign." },
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
      if (args.emails) body.emails = args.emails;
      if (args.phones) body.phones = args.phones;
      if (args.stage) body.stage = String(args.stage);
      if (args.segment) body.segment = String(args.segment);
      if (args.step) body.step = String(args.step);
      if (args.headline) body.headline = String(args.headline);
      if (args.keywords) body.keywords = args.keywords;
      if (args.notes) body.notes = String(args.notes);
      if (args.assign_to) body.assignTo = String(args.assign_to);
      if (args.custom_fields) body.customFields = args.custom_fields;
      if (args.app_links) body.appLinks = args.app_links;

      const response = await clozeFetch(
        toolCtx,
        "/people/update",
        accessToken,
        { method: "POST", body: JSON.stringify(body) },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          success: false,
          data: null,
          error: `Cloze person change failed (HTTP ${response.status}): ${text.slice(0, 500)}`,
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
        data: { message: "Person updated in Cloze." },
        error: undefined,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: `Cloze person change error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
