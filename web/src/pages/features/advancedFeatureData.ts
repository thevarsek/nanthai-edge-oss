import { Code2, Puzzle } from "lucide-react";

import type { FeatureMeta } from "./featureData";

export const advancedFeatures: FeatureMeta[] = [
  {
    slug: "skills-helpers",
    title: "AI Skills & focused helpers",
    tagline: "Give your AI a specialist playbook, or let it split a larger task across focused helpers.",
    indexDescription:
      "Choose from 60+ built-in skills, create your own instructions, and apply them by default, by persona, by chat, or for one message. In eligible Pro chats, the assistant can also delegate independent work to up to three focused helpers and bring the results back together.",
    tier: "pro",
    icon: Puzzle,
    accentClass: "text-[var(--edge-amber)]",
    related: ["personas", "automated-tasks", "analysis-code"],
    i18nPrefix: "sh",
    titleKey: "feature_title_skills_helpers",
  },
  {
    slug: "analysis-code",
    title: "Analysis, code & charts",
    tagline: "Turn uploaded data and technical questions into working analysis, charts, and downloadable files.",
    indexDescription:
      "Edge can use isolated workspaces and Python to inspect files, transform data, run calculations, and produce charts or reusable outputs. Standard analysis is included with Pro; heavier tasks may move into a bounded cloud sandbox when the workflow needs more packages or compute.",
    tier: "pro",
    icon: Code2,
    accentClass: "text-[var(--edge-blue)]",
    related: ["skills-helpers", "documents", "knowledge-base"],
    i18nPrefix: "ac",
    titleKey: "feature_title_analysis_code",
  },
];
