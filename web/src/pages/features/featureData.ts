import type { LucideIcon } from "lucide-react";
import type { TFunction } from "i18next";
import {
  MessageSquare,
  Search,
  Sparkles,
  SlidersHorizontal,
  FolderOpen,
  CalendarClock,
  Plug,
  UserCircle,
  BookOpen,
  Brain,
  Palette,
  Crown,
  Key,
  Users,
  GitBranch,
  Receipt,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Central metadata for every feature page.                          */
/*  Used by: FeaturesIndexPage, FeaturePageLayout (related features), */
/*  header/footer navigation, sitemap generation, SEO.                */
/* ------------------------------------------------------------------ */

export type FeatureTier = "free" | "pro" | "free-pro" | "none";

export interface FeatureMeta {
  /** URL slug — must match the route `/features/:slug` */
  slug: string;
  /** Display name */
  title: string;
  /** One-sentence tagline shown in hero & cards */
  tagline: string;
  /** Short description for the index card (2 sentences max) */
  indexDescription: string;
  /** Tier badge */
  tier: FeatureTier;
  /** Lucide icon for index cards & nav */
  icon: LucideIcon;
  /** Accent color class (Tailwind) for per-feature tinting */
  accentClass: string;
  /** Related feature slugs (shown at bottom of each page) */
  related: string[];
  /** Translation prefix used for seo/feature copy keys */
  i18nPrefix: string;
  /** Optional translation key for the feature title */
  titleKey?: string;
}

export const features: FeatureMeta[] = [
  {
    slug: "multi-model-chat",
    title: "Multi-Model Chat",
    tagline: "Ask one question, get answers from up to three AI models at once.",
    indexDescription:
      "Send the same prompt to multiple AI models simultaneously. Compare responses, fork conversations, and queue follow-ups while models are still thinking.",
    tier: "free",
    icon: MessageSquare,
    accentClass: "text-[var(--edge-cyan)]",
    related: ["participant-options", "branching", "personas"],
    i18nPrefix: "mmc",
    titleKey: "multi_model_chat",
  },
  {
    slug: "participant-options",
    title: "Participant Options",
    tagline: "Browse 150+ AI models with smart filters, sorting, and a guided wizard.",
    indexDescription:
      "The participant picker lets you search, filter by capability (free, vision, image gen, tools), sort by 9 criteria, and use a 3-step wizard that recommends the best model for your task.",
    tier: "free",
    icon: Users,
    accentClass: "text-[var(--edge-blue)]",
    related: ["multi-model-chat", "chat-defaults", "personas"],
    i18nPrefix: "po",
    titleKey: "feature_title_participant_options",
  },
  {
    slug: "branching",
    title: "Branching",
    tagline: "Every conversation is a tree. Explore alternatives, navigate forks, and merge ideas.",
    indexDescription:
      "Regenerate, retry with a different model, or use multi-model chat to create parallel branches. Branch indicator pills let you switch between siblings in chat view. See the full tree in Ideascape.",
    tier: "free",
    icon: GitBranch,
    accentClass: "text-[var(--edge-cyan)]",
    related: ["ideascapes", "multi-model-chat", "personas"],
    i18nPrefix: "br",
    titleKey: "feature_title_branching",
  },
  {
    slug: "search",
    title: "Search & Research",
    tagline: "From quick lookups to full research papers — search the web without leaving your chat.",
    indexDescription:
      "Basic web search is free. Pro unlocks three complexity tiers and a full research pipeline that plans queries, iterates on sources, and writes a cited paper.",
    tier: "free-pro",
    icon: Search,
    accentClass: "text-[var(--edge-blue)]",
    related: ["multi-model-chat", "knowledge-base", "automated-tasks"],
    i18nPrefix: "sr",
    titleKey: "home_cap_search_title",
  },
  {
    slug: "personas",
    title: "Personas",
    tagline: "Create AI identities with their own personality, model, and tools.",
    indexDescription:
      "Build specialised AI assistants with a custom name, avatar, system prompt, model, temperature, and tool access. Assign them to chats, scheduled jobs, or autonomous sessions.",
    tier: "pro",
    icon: UserCircle,
    accentClass: "text-[var(--edge-coral)]",
    related: ["memories", "knowledge-base", "automated-tasks"],
    i18nPrefix: "pe",
    titleKey: "personas",
  },
  {
    slug: "memories",
    title: "Memories",
    tagline: "AI that remembers your preferences, projects, and context across every conversation.",
    indexDescription:
      "Edge can save facts about you — your writing style, current projects, relationships, and goals. Memory is categorised, searchable, and fully transparent.",
    tier: "pro",
    icon: Brain,
    accentClass: "text-[var(--edge-cyan)]",
    related: ["personas", "knowledge-base", "chat-defaults"],
    i18nPrefix: "me",
    titleKey: "memories",
  },
  {
    slug: "knowledge-base",
    title: "Knowledge Base",
    tagline: "Upload reference material once and pull it into any conversation.",
    indexDescription:
      "Add PDFs, documents, and spreadsheets to your knowledge base. Attach them to chats or scheduled jobs so your AI always has the context it needs.",
    tier: "pro",
    icon: BookOpen,
    accentClass: "text-[var(--edge-amber)]",
    related: ["memories", "personas", "automated-tasks"],
    i18nPrefix: "kb",
    titleKey: "knowledge_base",
  },
  {
    slug: "ideascapes",
    title: "Ideascapes",
    tagline: "Switch any conversation into a spatial canvas and explore ideas visually.",
    indexDescription:
      "Arrange AI responses as movable nodes connected by their branching structure. Select context nodes, create new branches, and zoom across your full conversation tree. Positions persist so you can pick up where you left off.",
    tier: "pro",
    icon: Sparkles,
    accentClass: "text-[var(--edge-amber)]",
    related: ["branching", "multi-model-chat", "memories"],
    i18nPrefix: "is",
    titleKey: "ideascapes",
  },
  {
    slug: "automated-tasks",
    title: "Automated Tasks",
    tagline: "Schedule recurring AI tasks and let them run in the background.",
    indexDescription:
      "Create multi-step pipelines — each with its own model, persona, search mode, and integrations — and run them on a schedule. Daily briefings, weekly reports, monitoring jobs, and more.",
    tier: "pro",
    icon: CalendarClock,
    accentClass: "text-[var(--edge-cyan)]",
    related: ["personas", "integrations", "search"],
    i18nPrefix: "at",
    titleKey: "feature_title_automated_tasks",
  },
  {
    slug: "integrations",
    title: "Integrations",
    tagline: "Connect Google, Microsoft, Notion, and Apple Calendar directly to your AI.",
    indexDescription:
      "Read and send emails, browse cloud files, manage calendar events, search Notion pages and databases — all from within any chat, persona, or scheduled job.",
    tier: "pro",
    icon: Plug,
    accentClass: "text-[var(--edge-blue)]",
    related: ["automated-tasks", "personas", "knowledge-base"],
    i18nPrefix: "ig",
    titleKey: "integrations",
  },
  {
    slug: "chat-defaults",
    title: "Chat Defaults & Favorites",
    tagline: "Set your ideal starting point for every new conversation.",
    indexDescription:
      "Choose your default model, temperature, and token limits. Pin favourite model combos and personas to a quick-launch strip at the top of your chat list.",
    tier: "free",
    icon: SlidersHorizontal,
    accentClass: "text-[var(--edge-peach)]",
    related: ["multi-model-chat", "personas", "folders"],
    i18nPrefix: "cd",
    titleKey: "feature_title_chat_defaults_favorites",
  },
  {
    slug: "folders",
    title: "Folders",
    tagline: "Organise conversations into folders and find anything instantly.",
    indexDescription:
      "Create named folders with custom colours, move chats in bulk, filter the sidebar by folder, and search across all conversations by title or content.",
    tier: "free",
    icon: FolderOpen,
    accentClass: "text-[var(--edge-amber)]",
    related: ["chat-defaults", "automated-tasks", "multi-model-chat"],
    i18nPrefix: "fo",
    titleKey: "folders",
  },
  {
    slug: "themes",
    title: "Themes & Appearance",
    tagline: "Make the app look the way you want — dark, light, or somewhere in between.",
    indexDescription:
      "Choose system, dark, or light mode. Pick from four accent colour themes: Vibrant, High Contrast, Teal, and Lilac. Your choice syncs across all your devices.",
    tier: "free",
    icon: Palette,
    accentClass: "text-[var(--edge-peach)]",
    related: ["chat-defaults", "personas", "pro-vs-free"],
    i18nPrefix: "th",
    titleKey: "feature_title_themes_appearance",
  },
  {
    slug: "price-transparency",
    title: "Price Transparency",
    tagline: "See the cost of every response, your running total, and your remaining balance — in the chat.",
    indexDescription:
      "Advanced Stats shows per-message generation cost, a live chat total, and a 4-bucket breakdown (Responses, Memory, Search, Other). Your OpenRouter balance sits right in the header. Full visibility, zero markup.",
    tier: "free",
    icon: Receipt,
    accentClass: "text-[var(--edge-cyan)]",
    related: ["byok", "pro-vs-free", "memories"],
    i18nPrefix: "pt",
    titleKey: "feature_title_price_transparency",
  },
  {
    slug: "byok",
    title: "Bring Your Own Key",
    tagline: "Connect your OpenRouter account and pay only for what you use — no markup.",
    indexDescription:
      "Edge uses a bring-your-own-key model. You connect your OpenRouter account and every token is billed at OpenRouter's listed rate. You can even add your own provider keys for direct rate control.",
    tier: "free",
    icon: Key,
    accentClass: "text-[var(--edge-amber)]",
    related: ["pro-vs-free", "participant-options", "chat-defaults"],
    i18nPrefix: "bk",
    titleKey: "feature_title_byok",
  },
  {
    slug: "pro-vs-free",
    title: "Pro vs Free",
    tagline: "Everything you get for free — and what Pro unlocks.",
    indexDescription:
      "The free tier is a complete multi-model AI chat. Pro is a one-time £4.99 purchase that unlocks personas, memory, scheduled jobs, advanced search, integrations, and more.",
    tier: "none",
    icon: Crown,
    accentClass: "text-[var(--edge-coral)]",
    related: ["multi-model-chat", "personas", "byok"],
    i18nPrefix: "pf",
    titleKey: "feature_title_pro_vs_free",
  },
];

/** Lookup a feature by slug. Returns undefined if not found. */
export function getFeature(slug: string): FeatureMeta | undefined {
  return features.find((f) => f.slug === slug);
}

/** Get multiple features by slug array. Filters out any not found. */
export function getRelatedFeatures(slugs: string[]): FeatureMeta[] {
  return slugs
    .map((s) => features.find((f) => f.slug === s))
    .filter((f): f is FeatureMeta => f !== undefined);
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const match = trimmed.match(/^(.+?[.!?。！？])(?:\s|$)/);
  return (match?.[1] ?? trimmed).trim();
}

export function localizeFeature(meta: FeatureMeta, t: TFunction): FeatureMeta {
  const localizedTitle = meta.titleKey
    ? t(meta.titleKey, { defaultValue: meta.title })
    : meta.title;
  const localizedDescription = t(`${meta.i18nPrefix}_seo_desc`, { defaultValue: meta.indexDescription });
  return {
    ...meta,
    title: localizedTitle,
    tagline: firstSentence(localizedDescription),
    indexDescription: localizedDescription,
  };
}
