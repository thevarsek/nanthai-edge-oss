import type { ContentLanguage } from "@/lib/contentLocale";

export const topicKeys: Record<string, string> = {
  "Choosing and comparing models": "content_topic_models",
  "Connected work and tasks": "content_topic_work",
  "Accounts and costs": "content_topic_costs",
  "Files, images and memory": "content_topic_files",
  "Agent context and memory": "content_topic_context",
};

export function articleDate(date: string, language: ContentLanguage) {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : language, {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
