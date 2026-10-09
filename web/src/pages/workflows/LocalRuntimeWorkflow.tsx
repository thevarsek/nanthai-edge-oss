import {
  Cloud, Code2, Laptop, Download, Link2, Smartphone, FileText,
  SlidersHorizontal, CalendarClock, type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AnimateOnScroll } from "@/pages/features/illustrations/IllustrationPrimitives";
import { RuntimeDownloadLink } from "@/components/shared/RuntimeDownloadLink";

const connections: Array<{ key: string; label: string; icon: LucideIcon }> = [
  { key: "cloud", label: "OpenRouter", icon: Cloud },
  { key: "codex", label: "Codex", icon: Code2 },
  { key: "pi", label: "Pi", icon: Laptop },
];
const capabilities: Array<{ key: string; icon: LucideIcon }> = [
  { key: "share", icon: FileText },
  { key: "control", icon: SlidersHorizontal },
  { key: "schedule", icon: CalendarClock },
];
const setupSteps: Array<{ key: string; icon: LucideIcon }> = [
  { key: "install", icon: Download },
  { key: "pair", icon: Link2 },
  { key: "choose", icon: Smartphone },
];

export function LocalRuntimeWorkflow() {
  const { t } = useTranslation();
  return (
    <section
      className="mt-16 border-t eborder-12 pt-12"
      aria-labelledby="local-connections-title"
    >
      <h2
        id="local-connections-title"
        className="edge-display max-w-4xl text-3xl uppercase efg-heading"
      >
        {t("local_work_connections_title")}
      </h2>
      <div className="mt-8 grid gap-8 md:grid-cols-3">
        {connections.map(({ key, label, icon: Icon }) => (
          <AnimateOnScroll key={key} className="border-t eborder-12 pt-5">
            <Icon size={28} className="edge-accent" aria-hidden="true" />
            <h3 className="edge-display mt-5 text-2xl efg-heading">{label}</h3>
            <p className="mt-4 leading-relaxed efg-60">{t(`local_work_${key}`)}</p>
          </AnimateOnScroll>
        ))}
      </div>
      <div className="mt-12 grid gap-8 md:grid-cols-3">
        {capabilities.map(({ key, icon: Icon }) => (
          <AnimateOnScroll key={key} className="border-t eborder-12 pt-5">
            <Icon size={24} className="edge-accent" aria-hidden="true" />
            <h3 className="edge-display mt-5 text-2xl efg-heading">
              {t(`local_work_${key}_title`)}
            </h3>
            <p className="mt-4 leading-relaxed efg-60">{t(`local_work_${key}`)}</p>
          </AnimateOnScroll>
        ))}
      </div>
      <section id="mac-setup" className="scroll-mt-24 mt-12 border-t eborder-12 pt-8">
        <h2 className="edge-display text-3xl uppercase efg-heading">
          {t("local_work_setup_title")}
        </h2>
        <ol className="mt-8 grid gap-8 md:grid-cols-3">
          {setupSteps.map(({ key, icon: Icon }) => (
            <li key={key}><AnimateOnScroll>
              <Icon size={28} className="edge-accent" aria-hidden="true" />
              <h3 className="edge-display mt-5 text-2xl efg-heading">
                {t(`local_work_${key}_title`)}
              </h3>
              <p className="mt-3 leading-relaxed efg-70">{t(`local_work_${key}`)}</p>
            </AnimateOnScroll></li>
          ))}
        </ol>
        <RuntimeDownloadLink
          fallbackToSetup
          className="mt-8 inline-flex rounded-full ecta px-7 py-3 font-medium"
        />
        <p className="mt-5 max-w-3xl text-sm leading-relaxed efg-60">
          {t("local_work_connections_note")}
        </p>
      </section>
    </section>
  );
}
