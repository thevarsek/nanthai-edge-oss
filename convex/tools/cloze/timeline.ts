// convex/tools/cloze/timeline.ts
// =============================================================================
// Cloze timeline tools: add_note, add_todo, timeline (read), save_draft,
// about_me.
//
// Maps to:
//   POST /v1/timeline/content/create       — cloze_add_note
//   POST /v1/timeline/todo/create          — cloze_add_todo
//   POST /v1/timeline/communication/create — cloze_save_draft
//   GET  /v1/people/get                    — cloze_timeline (read activity)
//   GET  /v1/user/profile                  — cloze_about_me
// =============================================================================

import { createTool } from "../registry";
import { getClozeAccessToken } from "./auth";
import { clozeFetch } from "./client";

// ---------------------------------------------------------------------------
// cloze_add_note
// ---------------------------------------------------------------------------

export const clozeAddNote = createTool({
  name: "cloze_add_note",
  description:
    "Add a note to a person, company, or project in Cloze. " +
    "Notes appear on the timeline. You can reference people/projects " +
    "so the note is linked to them.",
  parameters: {
    type: "object",
    properties: {
      subject: {
        type: "string",
        description: "Note subject / title.",
      },
      body: {
        type: "string",
        description: "Note body text.",
      },
      body_type: {
        type: "string",
        description: "'html' or 'text' (default 'text').",
      },
      references: {
        type: "array",
        items: { type: "object" },
        description:
          'People/companies/projects to link: [{"value":"john@example.com","name":"John Doe"}].',
      },
      source: {
        type: "string",
        description: "Source domain for the note (e.g. 'nanthai.com'). Required.",
      },
      unique_id: {
        type: "string",
        description: "Unique ID from your system. Required (prevents duplicates).",
      },
      date: {
        type: "string",
        description: "ISO date/time or UTC ms timestamp. Defaults to now.",
      },
    },
    required: ["source", "unique_id"],
  },

  execute: async (toolCtx, args) => {
    try {
      const { accessToken } = await getClozeAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      const body: Record<string, unknown> = {
        style: "note",
        source: String(args.source),
        uniqueid: String(args.unique_id),
      };
      if (args.subject) body.subject = String(args.subject);
      if (args.body) body.body = String(args.body);
      if (args.body_type) body.bodytype = String(args.body_type);
      if (args.references) body.references = args.references;
      if (args.date) body.date = String(args.date);

      const response = await clozeFetch(
        toolCtx,
        "/timeline/content/create",
        accessToken,
        { method: "POST", body: JSON.stringify(body) },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          success: false,
          data: null,
          error: `Cloze add note failed (HTTP ${response.status}): ${text.slice(0, 500)}`,
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
        data: { message: "Note added to Cloze timeline." },
        error: undefined,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: `Cloze add note error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

// ---------------------------------------------------------------------------
// cloze_add_todo
// ---------------------------------------------------------------------------

export const clozeAddTodo = createTool({
  name: "cloze_add_todo",
  description:
    "Create a to-do / task in Cloze. Can be assigned to a team member " +
    "and linked to specific people via the participants field.",
  parameters: {
    type: "object",
    properties: {
      subject: {
        type: "string",
        description: "To-do description / title. Required.",
      },
      when: {
        type: "string",
        description:
          "Due date as ISO string, UTC ms timestamp, or '1' for 'someday'. " +
          "Omit for 'someday'.",
      },
      participants: {
        type: "array",
        items: { type: "string" },
        description: "Email/phone of related people.",
      },
      assignee: {
        type: "string",
        description: "Email of user to assign the to-do to (default: API caller).",
      },
      assigner: {
        type: "string",
        description: "Email of user creating the assignment (default: API caller).",
      },
    },
    required: ["subject"],
  },

  execute: async (toolCtx, args) => {
    try {
      const { accessToken } = await getClozeAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      const body: Record<string, unknown> = {
        subject: String(args.subject),
      };
      if (args.when) body.when = String(args.when);
      if (args.participants) body.participants = args.participants;
      if (args.assignee) body.assignee = String(args.assignee);
      if (args.assigner) body.assigner = String(args.assigner);

      const response = await clozeFetch(
        toolCtx,
        "/timeline/todo/create",
        accessToken,
        { method: "POST", body: JSON.stringify(body) },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          success: false,
          data: null,
          error: `Cloze add todo failed (HTTP ${response.status}): ${text.slice(0, 500)}`,
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
        data: { message: "To-do created in Cloze." },
        error: undefined,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: `Cloze add todo error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

// ---------------------------------------------------------------------------
// cloze_timeline — Read a person's recent activity / timeline
// ---------------------------------------------------------------------------

export const clozeTimeline = createTool({
  name: "cloze_timeline",
  description:
    "Get a person's record and recent activity from Cloze. " +
    "Returns the full person record including name, emails, phones, " +
    "stage, segment, about notes, and timeline items. " +
    "Look up by email address or Cloze unique ID.",
  parameters: {
    type: "object",
    properties: {
      email: {
        type: "string",
        description: "Email address of the person to look up.",
      },
      unique_id: {
        type: "string",
        description: "Cloze internal unique ID of the person.",
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
      if (args.email) params.set("value", String(args.email));
      if (args.unique_id) params.set("uniqueid", String(args.unique_id));

      if (!args.email && !args.unique_id) {
        return {
          success: false,
          data: null,
          error: "Provide either 'email' or 'unique_id' to look up a person.",
        };
      }

      const response = await clozeFetch(
        toolCtx,
        `/people/get?${params}`,
        accessToken,
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          success: false,
          data: null,
          error: `Cloze timeline failed (HTTP ${response.status}): ${text.slice(0, 500)}`,
        };
      }

      const result = (await response.json()) as {
        errorcode: number;
        message?: string;
        [key: string]: unknown;
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
        data: result,
        error: undefined,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: `Cloze timeline error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

// ---------------------------------------------------------------------------
// cloze_save_draft — Save an email draft via communication/create
// ---------------------------------------------------------------------------

export const clozeSaveDraft = createTool({
  name: "cloze_save_draft",
  description:
    "Save an email draft in Cloze. Creates an email communication record " +
    "on the timeline. The draft will appear in the person's timeline.",
  parameters: {
    type: "object",
    properties: {
      to: {
        type: "array",
        items: { type: "object" },
        description:
          'Recipients: [{"value":"jane@co.com","name":"Jane","role":"to"}]. ' +
          "role: 'to', 'cc', or 'bcc'.",
      },
      from: {
        type: "string",
        description: "Sender email address.",
      },
      subject: {
        type: "string",
        description: "Email subject line.",
      },
      body: {
        type: "string",
        description: "Email body.",
      },
      body_type: {
        type: "string",
        description: "'html' or 'text' (default 'text').",
      },
      references: {
        type: "array",
        items: { type: "object" },
        description: "People/companies/projects to link the email to.",
      },
    },
    required: ["subject", "body"],
  },

  execute: async (toolCtx, args) => {
    try {
      const { accessToken } = await getClozeAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      const body: Record<string, unknown> = {
        style: "email",
        subject: String(args.subject),
        body: String(args.body),
      };
      if (args.body_type) body.bodytype = String(args.body_type);
      if (args.from) body.from = String(args.from);
      if (args.to) body.recipients = args.to;
      if (args.references) body.references = args.references;

      const response = await clozeFetch(
        toolCtx,
        "/timeline/communication/create",
        accessToken,
        { method: "POST", body: JSON.stringify(body) },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          success: false,
          data: null,
          error: `Cloze save draft failed (HTTP ${response.status}): ${text.slice(0, 500)}`,
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
        data: { message: "Email draft saved in Cloze." },
        error: undefined,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: `Cloze save draft error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

// ---------------------------------------------------------------------------
// cloze_about_me — Get current user profile
// ---------------------------------------------------------------------------

export const clozeAboutMe = createTool({
  name: "cloze_about_me",
  description:
    "Get the current Cloze user's profile. Returns name, email, " +
    "phone, address, photo URL, account scopes, and permissions.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },

  execute: async (toolCtx, _args) => {
    try {
      const { accessToken } = await getClozeAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      const response = await clozeFetch(
        toolCtx,
        "/user/profile",
        accessToken,
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          success: false,
          data: null,
          error: `Cloze about me failed (HTTP ${response.status}): ${text.slice(0, 500)}`,
        };
      }

      const result = (await response.json()) as {
        errorcode: number;
        profile?: Record<string, unknown>;
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
        data: result.profile ?? result,
        error: undefined,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: `Cloze about me error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
