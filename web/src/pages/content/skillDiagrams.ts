import type { Diagram } from "./diagramTypes";
export const skillDiagrams: Record<string, Diagram> = {
  "skills-as-tool-gates-1": {
    title: "NanthAI:Edge Architecture — Progressive Skill-Gated Tool Access",
    notes: ["Expose capabilities progressively. Load instructions on demand. Activate tools only when the task justifies them.", "LESS CONTEXT: Lower tokens, latency & cost. BETTER ROUTING: Explicit intent, fewer wrong turns. STRONGER CONTROL: Bounded capabilities, safer by design.", "Always Visible (Stable) → Discoverable (Lightweight) → On Demand (Loaded) → Activated (Contextual)", "NanthAI:Edge is a case-study system. Details are author-provided and not independently verified."],
    panels: [
      { heading: "1 USER REQUEST — Natural language task", lines: ['“Create an analytics report of our Q2 performance with charts.”'] },
      { heading: "2 BASE CONTEXT — Stable & cache-friendly", lines: ["System Prompt: Core instructions & runtime guard", "Base Tool Registry: load_skill, list_skills, search_chats, fetch_image, …"] },
      { heading: "3 SKILL CATALOG — Compact metadata only", lines: ["<available_skills>", "analytics_report: Use for data analysis, charts, and structured analytical output.", "document_drafting: Use for documents, proposals, memos, and generated files.", "</available_skills>"] },
      { heading: "4 LOAD SKILL — Model decides & calls", steps: ['Model Action: load_skill(“analytics_report”)', "Runtime Response: Loaded Skill Instructions — Downloaded body", "Routing Metadata — required profiles, required tools, constraints, version"] },
      { heading: "5 ACTIVATE PROFILES — Expand tool registry", lines: ["Activated Profiles: analytics, docs, workspace, integrations, …", "Active Tool Registry: Only tools from activated profiles"] },
      { heading: "6 EXECUTE & RESPOND — Use tools, complete task", steps: ["Tool Selection & Execution", "Synthesis & Final Answer", "Response to User"] },
      { heading: "THREE-LAYER CAPABILITY MODEL", lines: ["Capabilities are governed and expanded layer by layer.", "1. ACCOUNT & TIER: Determines what the user can access; Base registry varies by tier; Integration & capability eligibility.", "2. SKILLS (DISCOVER → LOAD): Modular instruction packages; Metadata for routing & policy; Load on demand via load_skill.", "3. EXECUTABLE TOOLS: Actual tool schemas & implementation; Unlocked via skill-declared profiles; Guarded by runtime authorization."] },
      { heading: "WHY PROGRESSIVE SKILL-GATED ACCESS?", lines: ["Context Economy: Only load what’s needed. Reduce token and latency cost.", "Better Decisions: Smaller relevant tool sets improve selection accuracy.", "Cache Stability: Stable prefixes and dynamic loads improve cache hit rates.", "Governance & Safety: Bounded capabilities with clear policies and guards.", "Observability: Explicit skill loads make intent measurable."] },
    ],
  },
  "skills-as-tool-gates-2": { title: "Layers of progressive access", columns: ["Layer", "Exposed Content", "Timing"], rows: [
    ["Catalog metadata", "Slug, name, compact summary", "Always or session start"], ["Instruction body", "Full workflow rules and guidance", "On load_skill"], ["Tool surface", "Required executable tool schemas", "After skill activation"],
  ] },
  "skills-as-tool-gates-3": { title: "Skill catalog measurements", columns: ["Measurement", "Approximate Value"], rows: [
    ["Visible system skills", "55"], ["Hidden / non-visible skills", "11"], ["catalog size", "~5,055 tokens"], ["Full visible skill instruction size", "~67,044 tokens"], ["Average catalog entry", "~92 tokens per skill"], ["Average full skill body", "~1,219 tokens per skill"], ["Catalog vs full instruction reduction", "~92.5%"],
  ] },
  "skills-as-tool-gates-4": { title: "Tool registry measurements", columns: ["Measurement", "Approximate Value"], rows: [
    ["Base registry tools", "4"], ["Fully expanded registry tools", "115"], ["Base tool-schema size", "~649 tokens"], ["Fully expanded tool-schema size", "~28,424 tokens"], ["Base registry vs full registry reduction", "~97.7%"],
  ] },
  "skills-as-tool-gates-5": { title: "Active profile measurements", columns: ["Active Profile State", "Tools Exposed", "Approx. Tool-Schema Tokens", "Reduction vs Full Registry"], rows: [
    ["Base only", "4", "~649", "97.7%"], ["Analytics", "8", "~1,762", "93.8%"], ["Workspace", "12", "~1,614", "94.3%"], ["Google", "18", "~3,197", "88.8%"], ["Slack", "14", "~2,732", "90.4%"], ["Docs", "20", "~7,892", "72.2%"], ["Docs + analytics", "24", "~9,004", "68.3%"], ["Docs + persistent runtime", "32", "~9,632", "66.1%"], ["All profiles", "115", "~28,424", "0%"],
  ] },
};
