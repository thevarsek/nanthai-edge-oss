// convex/tools/persona.ts
// =============================================================================
// AI tools for persona management: create and delete.
//
// Tier 1 tools (always on). Let the AI create or delete personas
// conversationally — e.g. "create a coding persona that uses Claude".
// =============================================================================

import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { createTool } from "./registry";

// ── create_persona ─────────────────────────────────────────────────────

export const createPersona = createTool({
  name: "create_persona",
  description:
    "Create a new persona with a name, system prompt, and optional model/avatar settings. " +
    "Use when the user wants a custom AI personality — e.g. 'create a coding persona' or " +
    "'make me a writing assistant'. Personas can be assigned to chats for specialised behaviour. " +
    "Checks for duplicate names before creating.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Display name for the persona (e.g. 'TypeScript Expert'). Must be unique.",
      },
      systemPrompt: {
        type: "string",
        description:
          "The system prompt that defines the persona's behaviour, expertise, and tone. " +
          "Be detailed and specific for best results.",
      },
      description: {
        type: "string",
        description: "Short description of what this persona is for (shown in the persona picker).",
      },
      modelId: {
        type: "string",
        description:
          "OpenRouter model ID to use (e.g. 'anthropic/claude-sonnet-4'). " +
          "If omitted, the persona uses the chat's default model.",
      },
      temperature: {
        type: "number",
        description: "Sampling temperature (0.0–2.0). Lower = more focused, higher = more creative.",
      },
      maxTokens: {
        type: "number",
        description: "Maximum response tokens.",
      },
      avatarEmoji: {
        type: "string",
        description: "Single emoji for the persona's avatar (e.g. '🔷', '🧑‍💻', '✍️').",
      },
      avatarColor: {
        type: "string",
        description: "Hex color for the avatar background (e.g. '#4A90D9').",
      },
      enabledIntegrations: {
        type: "array",
        items: { type: "string" },
        description: "OAuth integrations this persona should have access to (e.g. ['gmail', 'calendar']).",
      },
    },
    required: ["name", "systemPrompt"],
  },

  execute: async (toolCtx, args) => {
    const name = args.name as string | undefined;
    const systemPrompt = args.systemPrompt as string | undefined;

    if (!name || typeof name !== "string" || !name.trim()) {
      return { success: false, data: null, error: "Missing or empty 'name'" };
    }
    if (!systemPrompt || typeof systemPrompt !== "string" || !systemPrompt.trim()) {
      return { success: false, data: null, error: "Missing or empty 'systemPrompt'" };
    }

    try {
      // Check for duplicate name
      const existing = await toolCtx.ctx.runQuery(
        internal.personas.queries.listPersonasInternal,
        { userId: toolCtx.userId },
      );
      const duplicate = existing.find(
        (p: Record<string, unknown>) =>
          (p.displayName as string).toLowerCase() === name.trim().toLowerCase(),
      );
      if (duplicate) {
        return {
          success: false,
          data: { existingPersonaId: duplicate._id, existingName: duplicate.displayName },
          error:
            `A persona named "${duplicate.displayName}" already exists. ` +
            `Choose a different name or ask the user if they'd like to update the existing one.`,
        };
      }

      // Validate temperature if provided
      if (args.temperature !== undefined) {
        const temp = args.temperature as number;
        if (typeof temp !== "number" || temp < 0 || temp > 2) {
          return { success: false, data: null, error: "Temperature must be between 0.0 and 2.0" };
        }
      }

      const personaId = await toolCtx.ctx.runMutation(
        internal.personas.mutations.createPersonaInternal,
        {
          userId: toolCtx.userId,
          displayName: name.trim(),
          personaDescription: (args.description as string) || undefined,
          systemPrompt,
          modelId: (args.modelId as string) || undefined,
          temperature: (args.temperature as number) ?? undefined,
          maxTokens: (args.maxTokens as number) ?? undefined,
          avatarEmoji: (args.avatarEmoji as string) || undefined,
          avatarColor: (args.avatarColor as string) || undefined,
          enabledIntegrations: (args.enabledIntegrations as string[]) || undefined,
        },
      );

      return {
        success: true,
        data: {
          personaId,
          name: name.trim(),
          message:
            `Created persona "${name.trim()}". The user can assign it to any chat ` +
            `from the participant picker, or reference it when creating scheduled jobs.`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to create persona: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});

// ── delete_persona ─────────────────────────────────────────────────────

export const deletePersona = createTool({
  name: "delete_persona",
  description:
    "Delete one of the user's personas by name or ID. Supports case-insensitive " +
    "name lookup for natural language requests.",
  parameters: {
    type: "object",
    properties: {
      personaId: {
        type: "string",
        description: "The persona's Convex document ID, if known.",
      },
      personaName: {
        type: "string",
        description: "The persona name to search for (case-insensitive partial match).",
      },
    },
  },

  execute: async (toolCtx, args) => {
    const personaId = args.personaId as string | undefined;
    const personaName = args.personaName as string | undefined;

    if (!personaId && !personaName) {
      return {
        success: false,
        data: null,
        error: "Provide either 'personaId' or 'personaName' to identify the persona to delete.",
      };
    }

    try {
      // List all user personas to resolve by name or verify ID
      const personas = await toolCtx.ctx.runQuery(
        internal.personas.queries.listPersonasInternal,
        { userId: toolCtx.userId },
      );

      let target: Record<string, unknown> | null = null;

      if (personaId) {
        target = personas.find((p: Record<string, unknown>) => p._id === personaId) ?? null;
        if (!target) {
          return { success: false, data: null, error: `No persona found with ID "${personaId}".` };
        }
      } else if (personaName) {
        const needle = personaName.toLowerCase();
        const matches = personas.filter((p: Record<string, unknown>) =>
          (p.displayName as string).toLowerCase().includes(needle),
        );

        if (matches.length === 0) {
          return {
            success: false,
            data: null,
            error: `No persona found matching "${personaName}".`,
          };
        }
        if (matches.length > 1) {
          const names = matches.map((p: Record<string, unknown>) => p.displayName);
          return {
            success: false,
            data: { ambiguousMatches: names },
            error:
              `Multiple personas match "${personaName}": ${names.join(", ")}. ` +
              `Please be more specific or use the exact name.`,
          };
        }
        target = matches[0];
      }

      if (!target) {
        return { success: false, data: null, error: "Could not resolve persona to delete." };
      }

      const targetId = target._id as Id<"personas">;
      const targetName = target.displayName as string;

      // Delete the persona
      await toolCtx.ctx.runMutation(
        internal.personas.mutations.removePersonaInternal,
        { personaId: targetId, userId: toolCtx.userId },
      );

      return {
        success: true,
        data: {
          deletedPersonaId: targetId as string,
          deletedPersonaName: targetName,
          message: `Deleted persona "${targetName}".`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to delete persona: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
