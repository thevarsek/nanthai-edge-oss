import type { Diagram } from "./diagramTypes";
export const beyondDiagrams: Record<string, Diagram> = {
  "beyond-the-transcript-1": { title: "NANTHAI / THE CONTEXT SERIES", panels: [
    { steps: ["11 MAY 2026 — Skills as Tool Gates: What capabilities enter?", "15 MAY 2026 — The Transcript Trap: What history carries forward?", "THIS FOLLOW-UP — Beyond the transcript: What happens in between?"] },
  ] },
  "beyond-the-transcript-2": { title: "Request content: full-history replay and selective context", panels: [
    { heading: "FULL-HISTORY REPLAY — REQUEST CONTENT", steps: ["Turn 1: earlier exchange + newest exchange → to model", "Turn 2: earlier exchanges + newest exchange → to model", "Turn 3: earlier exchanges + newest exchange → to model"], lines: ["Muted: earlier exchanges. Blue: newest exchange."] },
    { heading: "SELECTIVE CONTEXT", steps: ["Saved record", "Prepare", "Next request"] },
  ] },
  "beyond-the-transcript-3": { title: "Discover tools and load guidance", panels: [
    { heading: "PI — DISCOVER INDIVIDUAL TOOLS", steps: ["Server summary", "Search + inspect", "Selected tool calls"] },
    { heading: "NANTHAI — LOAD GUIDANCE AND TOOL PROFILES", steps: ["Skill catalog", "Load relevant skill", "Instructions + tools"] },
  ] },
  "beyond-the-transcript-4": { title: "NANTHAI / FROM EXECUTION TO USEFUL CONTEXT", panels: [
    { steps: ["Raw tool artifact — Exact output, file or error", "Compact tool memory — Useful evidence + source link", "Assembled context — Selected for this request"] },
  ], notes: ["Compact tool memory → Raw tool artifact: Recover the exact evidence when the task needs it."] },
  "beyond-the-transcript-5": { title: "During execution and context for later turns", panels: [
    { heading: "PI / DURING EXECUTION", steps: ["Tool responses", "Script: join / filter", "Selected output"], lines: ["Intermediate values stay inside the script."] },
    { heading: "NANTHAI / CONTEXT FOR LATER TURNS", steps: ["Artifacts + memories", "Context assembly", "Selected evidence"], lines: ["Source artifacts remain available for exact retrieval."] },
  ] },
  "beyond-the-transcript-6": { title: "SALES EXPORTS / COMPARE, EXPLAIN, CONTINUE", panels: [
    { heading: "BEFORE / NANTHAI", lines: ["Load analysis skill + tools", "Relevant capabilities"] },
    { heading: "DURING / PI", lines: ["Join, calculate and select rows", "Focused tool output"] },
    { heading: "AFTER / NANTHAI", lines: ["Assemble memories + source references", "Useful context next time"] },
  ] },
  "beyond-the-transcript-7": { title: "NanthAI prepares. Pi executes.", panels: [
    { heading: "NANTHAI", steps: ["Assembles context", "Conversation + branch; Memories + artifacts; Relevant instructions"] },
    { heading: "PI ON YOUR MAC", steps: ["Runs the agent loop", "Calls the LLM", "Executes available tools", "Returns the answer"] },
    { heading: "MODEL PROVIDER", lines: ["Generates responses", "The provider and model configured in Pi"] },
  ], notes: ["One conversation. Shared context. Your connected runtime.", "NanthAI → Pi on your Mac ↔ Model provider", "Answer returns to the NanthAI conversation", "The next turn starts with context prepared for the work ahead."] },
  "beyond-the-transcript-8": { title: "SHARED PRODUCT CONTEXT", panels: [
    { heading: "Shared inputs", lines: ["Conversation branch", "Summary + recent turns", "Memories + artifacts"] },
    { heading: "Canonical preparation", steps: ["Shared inputs → Canonical preparation", "Canonical preparation → Cloud model / Local Pi / Local Codex"] },
  ], notes: ["The shared work belongs to the conversation."] },
  "beyond-the-transcript-9": { title: "A comparison of emphasis", columns: ["FOCUS", "PI", "NANTHAI"], rows: [
    ["Find capabilities", "Tool discovery + skills", "Skills activate profiles"],
    ["Reduce context", "Scripts shape outputs", "Memories + assembly"],
    ["Continue work", "Sessions + compaction", "Shared canonical context"],
  ] },
};
