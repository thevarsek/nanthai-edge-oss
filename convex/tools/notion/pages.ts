// convex/tools/notion/pages.ts
// =============================================================================
// Notion tools: search, read, create, update, and delete pages.
//
// Uses Notion's markdown API where available for clean AI-friendly I/O.
// All calls use raw `fetch` with Bearer token auth and Notion-Version header.
// Tokens are obtained via `getNotionAccessToken()` which auto-refreshes.
// =============================================================================

import { createTool } from "../registry";
import { getNotionAccessToken } from "./auth";
import { notionFetch } from "./client";

/** Max characters we return to the model to avoid context blowup (~100 KB). */
const MAX_READ_CHARS = 100_000;

// ---------------------------------------------------------------------------
// notion_search — Search pages and databases by title
// ---------------------------------------------------------------------------

export const notionSearch = createTool({
  name: "notion_search",
  description:
    "Search the user's Notion workspace for pages and databases by title. " +
    "Use when the user asks to find a Notion page, look something up in Notion, " +
    "or check what pages exist. Returns page titles, IDs, and URLs. " +
    "Use this when the prompt does not already include the exact page or database ID. " +
    "Only pages shared with the integration during OAuth consent are searchable.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search query string. Searches page and database titles. " +
          "Leave empty to list recently edited pages.",
      },
      filter_type: {
        type: "string",
        description:
          "Filter results by type: 'page' for pages only, 'database' for databases only. " +
          "Omit to return both.",
      },
      max_results: {
        type: "number",
        description: "Maximum number of results to return (default 10, max 25).",
      },
    },
    required: [],
  },

  execute: async (toolCtx, args) => {
    const query = (args.query as string) || "";
    const filterType = args.filter_type as string | undefined;
    const maxResults = Math.min((args.max_results as number) || 10, 25);

    try {
      const { accessToken } = await getNotionAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      const body: Record<string, unknown> = {
        page_size: maxResults,
      };

      if (query) {
        body.query = query;
      }

      if (filterType === "page" || filterType === "database") {
        body.filter = { value: filterType, property: "object" };
      }

      body.sort = {
        direction: "descending",
        timestamp: "last_edited_time",
      };

      const response = await notionFetch(toolCtx, "/search", accessToken, {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Notion search failed (HTTP ${response.status}): ${errorText}`,
        };
      }

      const result = (await response.json()) as {
        results: Array<{
          object: string;
          id: string;
          url?: string;
          created_time?: string;
          last_edited_time?: string;
          archived?: boolean;
          properties?: Record<string, unknown>;
          title?: Array<{ plain_text: string }>;
          // Page title is nested in properties.title or properties.Name
        }>;
        has_more: boolean;
      };

      const items = result.results.map((item) => {
        // Extract title — different for pages vs databases
        let title = "Untitled";
        if (item.object === "database" && item.title) {
          title =
            item.title.map((t) => t.plain_text).join("") || "Untitled";
        } else if (item.properties) {
          // For pages, title is in the first "title" type property
          for (const prop of Object.values(item.properties)) {
            const p = prop as { type?: string; title?: Array<{ plain_text: string }> };
            if (p.type === "title" && p.title) {
              title =
                p.title.map((t: { plain_text: string }) => t.plain_text).join("") || "Untitled";
              break;
            }
          }
        }

        return {
          id: item.id,
          type: item.object,
          title,
          url: item.url,
          lastEdited: item.last_edited_time,
          archived: item.archived ?? false,
        };
      });

      return {
        success: true,
        data: {
          results: items,
          resultCount: items.length,
          hasMore: result.has_more,
          message:
            items.length > 0
              ? `Found ${items.length} result(s) in Notion${query ? ` for "${query}"` : ""}.`
              : `No results found in Notion${query ? ` for "${query}"` : ""}. Only pages shared with the integration are searchable.`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// notion_read_page — Read a page's content as markdown
// ---------------------------------------------------------------------------

export const notionReadPage = createTool({
  name: "notion_read_page",
  description:
    "Read the content of a Notion page as markdown. " +
    "Use when the user asks to read, review, summarize, or analyze a Notion page. " +
    "If the prompt or user already gives the page ID, use it directly. Otherwise, use notion_search first to find the page. " +
    "Returns the page content as markdown text along with metadata.",
  parameters: {
    type: "object",
    properties: {
      page_id: {
        type: "string",
        description:
          "Notion page ID (UUID format, from notion_search results). " +
          "Can be with or without hyphens.",
      },
    },
    required: ["page_id"],
  },

  execute: async (toolCtx, args) => {
    const pageId = args.page_id as string;

    if (!pageId) {
      return {
        success: false,
        data: null,
        error: "Missing 'page_id' parameter.",
      };
    }

    try {
      const { accessToken } = await getNotionAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      const metaResponse = await notionFetch(
        toolCtx,
        `/pages/${encodeURIComponent(pageId)}`,
        accessToken,
      );

      if (!metaResponse.ok) {
        const errorText = await metaResponse.text();
        return {
          success: false,
          data: null,
          error: `Failed to get page metadata (HTTP ${metaResponse.status}): ${errorText}`,
        };
      }

      const markdownResponse = await notionFetch(
        toolCtx,
        `/pages/${encodeURIComponent(pageId)}/markdown`,
        accessToken,
      );

      const meta = (await metaResponse.json()) as {
        id: string;
        url?: string;
        created_time?: string;
        last_edited_time?: string;
        archived?: boolean;
        properties?: Record<string, unknown>;
      };

      // Extract page title from properties
      let title = "Untitled";
      if (meta.properties) {
        for (const prop of Object.values(meta.properties)) {
          const p = prop as { type?: string; title?: Array<{ plain_text: string }> };
          if (p.type === "title" && p.title) {
            title =
              p.title
                .map((t: { plain_text: string }) => t.plain_text)
                .join("") || "Untitled";
            break;
          }
        }
      }

      // Handle markdown content
      let content = "";
      let truncated = false;

      if (markdownResponse.ok) {
        const mdResult = (await markdownResponse.json()) as {
          markdown?: string;
        };
        content = mdResult.markdown ?? "";
      } else {
        // Markdown API might not be available — fall back to indicating the error
        const errorText = await markdownResponse.text();
        content = `[Could not retrieve markdown content (HTTP ${markdownResponse.status}): ${errorText}]`;
      }

      if (content.length > MAX_READ_CHARS) {
        content = content.slice(0, MAX_READ_CHARS);
        truncated = true;
      }

      return {
        success: true,
        data: {
          pageId: meta.id,
          title,
          url: meta.url,
          lastEdited: meta.last_edited_time,
          archived: meta.archived ?? false,
          content,
          truncated,
          characterCount: content.length,
          message: truncated
            ? `Read first ${MAX_READ_CHARS.toLocaleString()} characters of "${title}" (content was truncated).`
            : `Read "${title}" (${content.length.toLocaleString()} characters).`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// notion_create_page — Create a new page from markdown content
// ---------------------------------------------------------------------------

export const notionCreatePage = createTool({
  name: "notion_create_page",
  description:
    "Create a new Notion page with markdown content. " +
    "Use when the user asks to create a new page, document, or note in Notion. " +
    "The page is created under a specified parent page (by ID). " +
    "If the prompt or user already gives the parent page ID, use it directly. " +
    "If no parent is specified, or the parent is only described by name, first use notion_search to find a suitable parent page. " +
    "Supports full markdown syntax: headings, lists, bold, italic, code blocks, links, etc.",
  parameters: {
    type: "object",
    properties: {
      parent_page_id: {
        type: "string",
        description:
          "ID of the parent page under which to create the new page. " +
          "Use notion_search to find suitable parent pages.",
      },
      title: {
        type: "string",
        description: "Title for the new Notion page.",
      },
      markdown: {
        type: "string",
        description:
          "Markdown content for the page body. Supports headings, lists, " +
          "bold, italic, code blocks, links, and other standard markdown.",
      },
    },
    required: ["parent_page_id", "title", "markdown"],
  },

  execute: async (toolCtx, args) => {
    const parentPageId = args.parent_page_id as string;
    const title = args.title as string;
    const markdown = args.markdown as string;

    if (!parentPageId || !title) {
      return {
        success: false,
        data: null,
        error: "Missing 'parent_page_id' or 'title'.",
      };
    }

    try {
      const { accessToken } = await getNotionAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      const body: Record<string, unknown> = {
        parent: { type: "page_id", page_id: parentPageId },
        properties: {
          title: {
            title: [{ text: { content: title } }],
          },
        },
        markdown: markdown || "",
      };

      const response = await notionFetch(toolCtx, "/pages", accessToken, {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Failed to create Notion page (HTTP ${response.status}): ${errorText}`,
        };
      }

      const result = (await response.json()) as {
        id: string;
        url?: string;
        created_time?: string;
      };

      return {
        success: true,
        data: {
          pageId: result.id,
          url: result.url,
          title,
          message: result.url
            ? `Created Notion page "${title}". [Open in Notion](${result.url})`
            : `Created Notion page "${title}" (ID: ${result.id}).`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// notion_update_page — Update a page's content with markdown
// ---------------------------------------------------------------------------

export const notionUpdatePage = createTool({
  name: "notion_update_page",
  description:
    "Update the content of an existing Notion page using markdown. " +
    "Use when the user asks to edit, update, append to, or modify a Notion page. " +
    "If the prompt or user already gives the page ID, use it directly. Otherwise, use notion_search first to find the page. " +
    "By default replaces all existing content. Set mode to 'append' to add content " +
    "after the existing content instead.",
  parameters: {
    type: "object",
    properties: {
      page_id: {
        type: "string",
        description: "Notion page ID to update (from notion_search results).",
      },
      markdown: {
        type: "string",
        description:
          "New markdown content for the page. " +
          "Supports headings, lists, bold, italic, code blocks, links, etc.",
      },
      mode: {
        type: "string",
        description:
          "Update mode: 'replace' to replace all content (default), " +
          "'append' to insert after existing content.",
      },
    },
    required: ["page_id", "markdown"],
  },

  execute: async (toolCtx, args) => {
    const pageId = args.page_id as string;
    const markdown = args.markdown as string;
    const mode = (args.mode as string) || "replace";

    if (!pageId || !markdown) {
      return {
        success: false,
        data: null,
        error: "Missing 'page_id' or 'markdown'.",
      };
    }

    try {
      const { accessToken } = await getNotionAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      const body: Record<string, unknown> = {
        markdown,
      };

      // Notion markdown API: PATCH replaces by default
      // For append, set type to "insert" with position "after"
      if (mode === "append") {
        body.type = "insert";
        body.position = "after";
      } else {
        body.type = "replace";
      }

      const response = await notionFetch(
        toolCtx,
        `/pages/${encodeURIComponent(pageId)}/markdown`,
        accessToken,
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Failed to update Notion page (HTTP ${response.status}): ${errorText}`,
        };
      }

      // Fetch updated page metadata for the response
      const metaResponse = await notionFetch(
        toolCtx,
        `/pages/${encodeURIComponent(pageId)}`,
        accessToken,
      );

      let title = "Unknown";
      let url: string | undefined;

      if (metaResponse.ok) {
        const meta = (await metaResponse.json()) as {
          url?: string;
          properties?: Record<string, unknown>;
        };
        url = meta.url;

        if (meta.properties) {
          for (const prop of Object.values(meta.properties)) {
            const p = prop as { type?: string; title?: Array<{ plain_text: string }> };
            if (p.type === "title" && p.title) {
              title =
                p.title
                  .map((t: { plain_text: string }) => t.plain_text)
                  .join("") || "Untitled";
              break;
            }
          }
        }
      }

      const action = mode === "append" ? "Appended content to" : "Updated";

      return {
        success: true,
        data: {
          pageId,
          title,
          url,
          mode,
          message: url
            ? `${action} Notion page "${title}". [Open in Notion](${url})`
            : `${action} Notion page "${title}" (ID: ${pageId}).`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// notion_delete_page — Archive (trash) a Notion page
// ---------------------------------------------------------------------------

export const notionDeletePage = createTool({
  name: "notion_delete_page",
  description:
    "Archive (move to trash) a Notion page. " +
    "Use when the user asks to delete, remove, or trash a Notion page. " +
    "This archives the page (it can be restored from trash in Notion). " +
    "If the prompt or user already gives the page ID, use it directly. Otherwise, use notion_search first to find the page.",
  parameters: {
    type: "object",
    properties: {
      page_id: {
        type: "string",
        description: "Notion page ID to archive (from notion_search results).",
      },
    },
    required: ["page_id"],
  },

  execute: async (toolCtx, args) => {
    const pageId = args.page_id as string;

    if (!pageId) {
      return {
        success: false,
        data: null,
        error: "Missing 'page_id' parameter.",
      };
    }

    try {
      const { accessToken } = await getNotionAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      // First get page title for the confirmation message
      const metaResponse = await notionFetch(
        toolCtx,
        `/pages/${encodeURIComponent(pageId)}`,
        accessToken,
      );

      let title = "Unknown";
      if (metaResponse.ok) {
        const meta = (await metaResponse.json()) as {
          properties?: Record<string, unknown>;
        };
        if (meta.properties) {
          for (const prop of Object.values(meta.properties)) {
            const p = prop as { type?: string; title?: Array<{ plain_text: string }> };
            if (p.type === "title" && p.title) {
              title =
                p.title
                  .map((t: { plain_text: string }) => t.plain_text)
                  .join("") || "Untitled";
              break;
            }
          }
        }
      }

      // Archive the page by setting archived: true
      const response = await notionFetch(
        toolCtx,
        `/pages/${encodeURIComponent(pageId)}`,
        accessToken,
        {
          method: "PATCH",
          body: JSON.stringify({ archived: true }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Failed to archive Notion page (HTTP ${response.status}): ${errorText}`,
        };
      }

      return {
        success: true,
        data: {
          pageId,
          title,
          archived: true,
          message: `Archived Notion page "${title}". It can be restored from the trash in Notion.`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// notion_update_database_entry — Update properties on a database row/entry
// ---------------------------------------------------------------------------

export const notionUpdateDatabaseEntry = createTool({
  name: "notion_update_database_entry",
  description:
    "Update properties (fields) on a Notion database entry (row). " +
    "Use when the user asks to change a Status, check a checkbox, update a date, " +
    "edit a text field, or modify any property on a database item. " +
    "If the prompt or user already gives the entry page_id, use it directly. " +
    "Otherwise, use notion_query_database to find the entry first. " +
    "and a properties object mapping property names to new values. " +
    'Example: page_id="abc-123", properties={"Status": "Done", "Priority": "High"}. ' +
    "Supports: title, rich_text, number, select, multi_select, date, checkbox, url, email, phone_number, status. " +
    "For select/status/multi_select, use the exact option name as it appears in the database.",
  parameters: {
    type: "object",
    properties: {
      page_id: {
        type: "string",
        description:
          "Page ID of the database entry to update (from notion_query_database results).",
      },
      properties: {
        type: "object",
        additionalProperties: true,
        description:
          "A JSON object mapping Notion property names to their new values. " +
          "Pass EXACTLY the property names as they appear in the database. " +
          "Examples:\n" +
          '  {"Status": "Done"} — set a select/status property\n' +
          '  {"Checked": true} — set a checkbox\n' +
          '  {"Priority": "High"} — set a select property\n' +
          '  {"Tags": ["urgent", "review"]} — set multi_select\n' +
          '  {"Due Date": "2026-03-15"} — set a date\n' +
          '  {"Notes": "Updated text"} — set a rich_text property\n' +
          '  {"Score": 42} — set a number property\n' +
          '  {"Title": "New name"} — rename the entry\n' +
          "The tool auto-detects the correct Notion property type from the database schema. " +
          "Just pass simple values: strings, numbers, booleans, or arrays of strings.",
      },
    },
    required: ["page_id", "properties"],
  },

  execute: async (toolCtx, args) => {
    const pageId = args.page_id as string;
    const userProps = args.properties as Record<string, unknown> | undefined;

    if (!pageId || !userProps || Object.keys(userProps).length === 0) {
      return {
        success: false,
        data: null,
        error: "Missing 'page_id' or 'properties' (must be a non-empty object).",
      };
    }

    try {
      const { accessToken } = await getNotionAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      // First, fetch the page to get its property schema so we can build
      // correctly typed Notion property payloads.
      const metaResponse = await notionFetch(
        toolCtx,
        `/pages/${encodeURIComponent(pageId)}`,
        accessToken,
      );

      if (!metaResponse.ok) {
        const errorText = await metaResponse.text();
        return {
          success: false,
          data: null,
          error: `Failed to fetch page metadata (HTTP ${metaResponse.status}): ${errorText}`,
        };
      }

      const meta = (await metaResponse.json()) as {
        id: string;
        url?: string;
        properties?: Record<string, { type?: string; [k: string]: unknown }>;
      };

      // Build the Notion properties payload using the schema types
      const notionProps: Record<string, unknown> = {};
      const updatedFields: string[] = [];

      for (const [propName, newValue] of Object.entries(userProps)) {
        const schemaProp = meta.properties?.[propName];
        const propType = schemaProp?.type;

        // Build the property payload based on the schema type
        const payload = buildPropertyPayload(propType, newValue);
        if (payload !== null) {
          notionProps[propName] = payload;
          updatedFields.push(propName);
        }
      }

      if (Object.keys(notionProps).length === 0) {
        return {
          success: false,
          data: null,
          error:
            "Could not build valid property updates. Check that property names match exactly " +
            "and values are compatible with the property types.",
        };
      }

      // PATCH the page with updated properties
      const response = await notionFetch(
        toolCtx,
        `/pages/${encodeURIComponent(pageId)}`,
        accessToken,
        {
          method: "PATCH",
          body: JSON.stringify({ properties: notionProps }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Failed to update database entry (HTTP ${response.status}): ${errorText}`,
        };
      }

      // Extract title from the response for the message
      const updated = (await response.json()) as {
        id: string;
        url?: string;
        properties?: Record<string, unknown>;
      };

      let title = "Unknown";
      if (updated.properties) {
        for (const prop of Object.values(updated.properties)) {
          const p = prop as { type?: string; title?: Array<{ plain_text: string }> };
          if (p.type === "title" && p.title) {
            title =
              p.title.map((t: { plain_text: string }) => t.plain_text).join("") || "Untitled";
            break;
          }
        }
      }

      return {
        success: true,
        data: {
          pageId: updated.id,
          title,
          url: updated.url ?? meta.url,
          updatedFields,
          message: updated.url
            ? `Updated ${updatedFields.join(", ")} on "${title}". [Open in Notion](${updated.url})`
            : `Updated ${updatedFields.join(", ")} on "${title}" (ID: ${updated.id}).`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

/**
 * Build a Notion API property payload from a user-supplied value and schema type.
 * Returns null if the type is unrecognized or the value can't be converted.
 */
function buildPropertyPayload(
  propType: string | undefined,
  value: unknown,
): unknown {
  switch (propType) {
    case "title": {
      const text = String(value ?? "");
      return { title: [{ text: { content: text } }] };
    }
    case "rich_text": {
      const text = String(value ?? "");
      return { rich_text: [{ text: { content: text } }] };
    }
    case "number":
      return { number: typeof value === "number" ? value : Number(value) };
    case "checkbox":
      return { checkbox: Boolean(value) };
    case "select": {
      const name = String(value ?? "");
      return { select: name ? { name } : null };
    }
    case "status": {
      const name = String(value ?? "");
      return { status: name ? { name } : null };
    }
    case "multi_select": {
      const arr = Array.isArray(value) ? value : [value];
      return {
        multi_select: arr
          .filter((v) => v != null && String(v).length > 0)
          .map((v) => ({ name: String(v) })),
      };
    }
    case "date": {
      if (typeof value === "string") {
        return { date: { start: value } };
      }
      if (
        typeof value === "object" &&
        value !== null &&
        "start" in (value as Record<string, unknown>)
      ) {
        return { date: value };
      }
      return { date: { start: String(value) } };
    }
    case "url":
      return { url: value ? String(value) : null };
    case "email":
      return { email: value ? String(value) : null };
    case "phone_number":
      return { phone_number: value ? String(value) : null };
    case "relation": {
      // Accept array of page IDs
      const ids = Array.isArray(value) ? value : [value];
      return {
        relation: ids
          .filter((v) => v != null)
          .map((v) => ({ id: String(v) })),
      };
    }
    default: {
      // For unknown types, try to infer from the value type
      if (typeof value === "boolean") return { checkbox: value };
      if (typeof value === "number") return { number: value };
      if (typeof value === "string") return { rich_text: [{ text: { content: value } }] };
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// notion_query_database — Query a Notion database with optional filters
// ---------------------------------------------------------------------------

export const notionQueryDatabase = createTool({
  name: "notion_query_database",
  description:
    "Query a Notion database to list its entries with optional filtering and sorting. " +
    "Use when the user asks to view, filter, or analyze data in a Notion database/table. " +
    "If the prompt or user already gives the database ID, use it directly. Otherwise, use notion_search first to find the database. " +
    "Returns page entries from the database with their property values.",
  parameters: {
    type: "object",
    properties: {
      database_id: {
        type: "string",
        description:
          "Notion database ID (from notion_search results with type 'database').",
      },
      filter: {
        type: "object",
        description:
          "Notion filter object (optional). See Notion API docs for filter syntax. " +
          "Example: { \"property\": \"Status\", \"select\": { \"equals\": \"Done\" } }",
      },
      max_results: {
        type: "number",
        description: "Maximum number of entries to return (default 20, max 50).",
      },
    },
    required: ["database_id"],
  },

  execute: async (toolCtx, args) => {
    const databaseId = args.database_id as string;
    const filter = args.filter as Record<string, unknown> | undefined;
    const maxResults = Math.min((args.max_results as number) || 20, 50);

    if (!databaseId) {
      return {
        success: false,
        data: null,
        error: "Missing 'database_id' parameter.",
      };
    }

    try {
      const { accessToken } = await getNotionAccessToken(
        toolCtx.ctx,
        toolCtx.userId,
      );

      const body: Record<string, unknown> = {
        page_size: maxResults,
      };

      if (filter) {
        body.filter = filter;
      }

      const response = await notionFetch(
        toolCtx,
        `/databases/${encodeURIComponent(databaseId)}/query`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          data: null,
          error: `Failed to query Notion database (HTTP ${response.status}): ${errorText}`,
        };
      }

      const result = (await response.json()) as {
        results: Array<{
          id: string;
          url?: string;
          created_time?: string;
          last_edited_time?: string;
          archived?: boolean;
          properties?: Record<string, unknown>;
        }>;
        has_more: boolean;
      };

      const entries = result.results.map((item) => {
        // Extract a simplified view of each property
        const props: Record<string, unknown> = {};
        let title = "Untitled";

        if (item.properties) {
          for (const [key, value] of Object.entries(item.properties)) {
            const prop = value as { type?: string; [k: string]: unknown };
            props[key] = extractPropertyValue(prop);

            // Also extract title
            if (prop.type === "title") {
              const titleArray = prop.title as Array<{ plain_text: string }> | undefined;
              if (titleArray && titleArray.length > 0) {
                title = titleArray.map((t) => t.plain_text).join("");
              }
            }
          }
        }

        return {
          id: item.id,
          title,
          url: item.url,
          lastEdited: item.last_edited_time,
          properties: props,
        };
      });

      return {
        success: true,
        data: {
          entries,
          resultCount: entries.length,
          hasMore: result.has_more,
          message:
            entries.length > 0
              ? `Found ${entries.length} entries in the Notion database.`
              : "No entries found in the Notion database matching the criteria.",
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a simplified human-readable value from a Notion property object.
 * Handles common property types; returns raw value for unknown types.
 */
function extractPropertyValue(prop: Record<string, unknown>): unknown {
  const type = prop.type as string | undefined;

  switch (type) {
    case "title": {
      const arr = prop.title as Array<{ plain_text: string }> | undefined;
      return arr ? arr.map((t) => t.plain_text).join("") : "";
    }
    case "rich_text": {
      const arr = prop.rich_text as Array<{ plain_text: string }> | undefined;
      return arr ? arr.map((t) => t.plain_text).join("") : "";
    }
    case "number":
      return prop.number;
    case "select": {
      const sel = prop.select as { name?: string } | null;
      return sel?.name ?? null;
    }
    case "multi_select": {
      const arr = prop.multi_select as Array<{ name: string }> | undefined;
      return arr ? arr.map((s) => s.name) : [];
    }
    case "date": {
      const d = prop.date as { start?: string; end?: string } | null;
      return d ? (d.end ? `${d.start} → ${d.end}` : d.start) : null;
    }
    case "checkbox":
      return prop.checkbox;
    case "url":
      return prop.url;
    case "email":
      return prop.email;
    case "phone_number":
      return prop.phone_number;
    case "status": {
      const st = prop.status as { name?: string } | null;
      return st?.name ?? null;
    }
    case "people": {
      const arr = prop.people as Array<{ name?: string }> | undefined;
      return arr ? arr.map((p) => p.name ?? "Unknown").join(", ") : "";
    }
    case "formula": {
      const f = prop.formula as { type?: string; [k: string]: unknown };
      if (f?.type) return f[f.type];
      return null;
    }
    case "relation": {
      const arr = prop.relation as Array<{ id: string }> | undefined;
      return arr ? arr.map((r) => r.id) : [];
    }
    case "rollup": {
      const r = prop.rollup as { type?: string; [k: string]: unknown };
      if (r?.type) return r[r.type];
      return null;
    }
    case "created_time":
      return prop.created_time;
    case "last_edited_time":
      return prop.last_edited_time;
    default:
      return `[${type ?? "unknown"}]`;
  }
}
