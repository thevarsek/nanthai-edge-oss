import {
  Brain,
  CalendarClock,
  Code2,
  Drama,
  FileText,
  FileStack,
  Globe,
  Image as ImageIcon,
  Key,
  Layers,
  LayoutGrid,
  MessagesSquare,
  Mic,
  Music,
  Puzzle,
  Film,
  Zap,
} from "lucide-react";

// ── Data (functions accepting t) ────────────────────────────────────

export function getHeadlinePoints(t: (k: string) => string) {
  return [
    t("home_chip_models"),
    t("home_chip_native"),
    t("home_chip_pro"),
    t("home_chip_tools"),
  ];
}

export function getHowItWorksSteps(t: (k: string) => string) {
  return [
    {
      icon: Key,
      step: "01",
      title: t("home_hiw_step1_title"),
      body: t("home_hiw_step1_body"),
    },
    {
      icon: LayoutGrid,
      step: "02",
      title: t("home_hiw_step2_title"),
      body: t("home_hiw_step2_body"),
    },
    {
      icon: Zap,
      step: "03",
      title: t("home_hiw_step3_title"),
      body: t("home_hiw_step3_body"),
    },
  ];
}

export function getCapabilityCards(t: (k: string) => string) {
  return [
    {
      icon: MessagesSquare,
      title: t("home_cap_chat_title"),
      body: t("home_cap_chat_body"),
      detail: t("free"),
      wide: true,
    },
    {
      icon: Drama,
      title: t("home_cap_personas_title"),
      body: t("home_cap_personas_body"),
      detail: t("pro_2"),
    },
    {
      icon: Brain,
      title: t("home_cap_memory_title"),
      body: t("home_cap_memory_body"),
      detail: t("pro_2"),
    },
    {
      icon: Globe,
      title: t("home_cap_search_title"),
      body: t("home_cap_search_body"),
      detail: t("home_cap_free_pro"),
      wide: true,
      rightAnchored: true,
    },
    {
      icon: CalendarClock,
      title: t("home_cap_jobs_title"),
      body: t("home_cap_jobs_body"),
      detail: t("pro_2"),
    },
    {
      icon: Zap,
      title: t("home_cap_auto_title"),
      body: t("home_cap_auto_body"),
      detail: t("pro_2"),
    },
    {
      icon: FileStack,
      title: t("home_cap_files_title"),
      body: t("home_cap_files_body"),
      detail: t("home_cap_free_pro"),
    },
    {
      icon: FileText,
      title: t("home_cap_documents_title"),
      body: t("home_cap_documents_body"),
      detail: t("pro_2"),
      href: "/features/documents",
      wide: true,
    },
    {
      icon: Puzzle,
      title: t("home_cap_skills_title"),
      body: t("home_cap_skills_body"),
      detail: t("pro_2"),
      href: "/features/skills-helpers",
    },
    {
      icon: Code2,
      title: t("home_cap_analysis_title"),
      body: t("home_cap_analysis_body"),
      detail: t("pro_2"),
      href: "/features/analysis-code",
      wide: true,
      rightAnchored: true,
    },
    {
      icon: Mic,
      title: t("home_cap_voice_title"),
      body: t("home_cap_voice_body"),
      detail: t("free"),
    },
    {
      icon: ImageIcon,
      title: t("home_cap_image_title"),
      body: t("home_cap_image_body"),
      detail: t("free"),
    },
    {
      icon: Film,
      title: t("home_cap_video_title"),
      body: t("home_cap_video_body"),
      detail: t("free"),
    },
    {
      icon: Music,
      title: t("home_cap_audio_title"),
      body: t("home_cap_audio_body"),
      detail: t("free"),
    },
    {
      icon: Layers,
      title: t("home_cap_ideascapes_title"),
      body: t("home_cap_ideascapes_body"),
      detail: t("pro_2"),
      wide: true,
      rightAnchored: true,
    },
  ];
}

export function getIntegrations(t: (k: string) => string) {
  return [
    {
      name: t("home_int_google_name"),
      services: [t("home_int_google_s1"), t("home_int_google_s2"), t("home_int_google_s3")],
      body: t("home_int_google_body"),
    },
    {
      name: t("home_int_ms_name"),
      services: [t("home_int_ms_s1"), t("home_int_ms_s2"), t("home_int_ms_s3")],
      body: t("home_int_ms_body"),
    },
    {
      name: t("home_int_notion_name"),
      services: [t("home_int_notion_s1"), t("home_int_notion_s2")],
      body: t("home_int_notion_body"),
    },
    {
      name: t("home_int_apple_name"),
      services: [t("home_int_apple_s1")],
      body: t("home_int_apple_body"),
    },
    {
      name: t("home_int_slack_name"),
      services: [t("home_int_slack_s1"), t("home_int_slack_s2")],
      body: t("home_int_slack_body"),
    },
    {
      name: t("home_int_cloze_name"),
      services: [t("home_int_cloze_s1"), t("home_int_cloze_s2")],
      body: t("home_int_cloze_body"),
    },
  ];
}

export function getFreeFeatures(t: (k: string) => string) {
  return [
    t("home_free_1"),
    t("home_free_2"),
    t("home_free_3"),
    t("home_free_4"),
    t("home_free_5"),
    t("home_free_6"),
    t("home_free_7"),
    t("home_free_8"),
    t("home_free_9"),
    t("home_free_10"),
  ];
}

export function getProFeatures(t: (k: string) => string) {
  return [
    t("home_pro_1"),
    t("home_pro_2"),
    t("home_pro_3"),
    t("home_pro_4"),
    t("home_pro_5"),
    t("home_pro_6"),
    t("home_pro_7"),
    t("home_pro_8"),
    t("home_pro_9"),
    t("home_pro_10"),
    t("home_pro_11"),
    t("home_pro_12"),
  ];
}
