import { createTool } from "./registry";

function normalizeTasks(value: unknown): Array<{ title: string; prompt: string }> | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) {
    return null;
  }

  const tasks: Array<{ title: string; prompt: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const task = item as { title?: unknown; prompt?: unknown };
    const title = typeof task.title === "string"
      ? task.title.trim()
      : "";
    const prompt = typeof task.prompt === "string"
      ? task.prompt.trim()
      : "";
    if (!title || !prompt) return null;
    tasks.push({ title, prompt });
  }
  return tasks;
}

export const spawnSubagents = createTool({
  name: "spawn_subagents",
  description:
    "Delegate up to 3 focused sub-tasks to parallel helper agents that share your current model, persona, and tools. " +
    "Use this when the work can be split into independent research, drafting, review, or comparison tasks. " +
    "Each task must be tightly scoped and self-contained.",
  parameters: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        description:
          "One to three focused child tasks. Keep prompts narrow and outcome-driven.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short label for this child task." },
            prompt: { type: "string", description: "Exact task for the child agent." },
          },
          required: ["title", "prompt"],
          additionalProperties: false,
        },
      },
    },
    required: ["tasks"],
    additionalProperties: false,
  },
  execute: async (_toolCtx, args) => {
    const tasks = normalizeTasks(args.tasks);
    if (!tasks) {
      return {
        success: false,
        data: null,
        error: "Provide between 1 and 3 tasks with non-empty title and prompt fields.",
      };
    }

    return {
      success: true,
      data: {
        queued: tasks.length,
        message: `Queued ${tasks.length} subagent task${tasks.length === 1 ? "" : "s"}.`,
      },
      deferred: {
        kind: "spawn_subagents",
        data: { tasks },
      },
    };
  },
});
