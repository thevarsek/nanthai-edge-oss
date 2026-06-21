import { ArrowRight, CalendarClock, FileText, Image, Layers, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

const modelRows = [
  { name: "Claude Sonnet", detail: "analysis", cost: "$0.004" },
  { name: "GPT-4.1", detail: "draft", cost: "$0.003" },
  { name: "Gemini 2.5", detail: "cross-check", cost: "$0.002" },
];

const contextItems = [
  { icon: FileText, labelKey: "home_cap_documents_title", meta: "DOCX + PDF" },
  { icon: Search, labelKey: "home_cap_search_title", meta: "web research" },
  { icon: CalendarClock, labelKey: "home_cap_jobs_title", meta: "weekly job" },
];

const outputItems = [
  { icon: Layers, labelKey: "home_cap_ideascapes_title" },
  { icon: Image, labelKey: "home_cap_image_title" },
  { icon: FileText, labelKey: "home_cap_files_title" },
];

export function HomeWorkflowProofSection() {
  const { t } = useTranslation();

  return (
    <section className="relative">
      <div className="container pb-8 pt-4 md:pb-16">
        <div className="edge-proof-panel overflow-hidden rounded-[1.75rem] p-5 md:p-8">
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.35fr_0.95fr]">
            <div className="edge-proof-lane rounded-2xl p-5">
              <div className="flex items-center justify-between gap-4">
                <span className="edge-label efg-35">OpenRouter</span>
                <span className="edge-proof-chip rounded-full px-2.5 py-1 text-[0.68rem]">
                  150+ models
                </span>
              </div>
              <div className="mt-6 space-y-3">
                {modelRows.map((model) => (
                  <div
                    key={model.name}
                    className="edge-proof-model-row rounded-xl p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="edge-sans text-[0.86rem] font-medium efg-85">
                        {model.name}
                      </span>
                      <span className="edge-mono text-[0.68rem] efg-45">
                        {model.cost}
                      </span>
                    </div>
                    <p className="edge-sans mt-1 text-[0.74rem] efg-50">
                      {model.detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="edge-proof-lane rounded-2xl p-5 md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                <span className="edge-label efg-35">{t("home_proof_label")}</span>
                  <h3 className="edge-display mt-3 text-[clamp(1.7rem,3vw,2.65rem)] efg-heading">
                    {t("home_cap_heading_line1")}{" "}
                    <span className="edge-accent">{t("home_cap_heading_line2")}</span>
                  </h3>
                </div>
                <span className="edge-proof-chip edge-proof-chip-warm rounded-full px-3 py-1 text-[0.72rem]">
                  BYOK
                </span>
              </div>

              <div className="edge-proof-brief mt-6 rounded-2xl p-4">
                <p className="edge-sans text-[0.82rem] leading-relaxed efg-65">
                  {t("home_proof_body")}
                </p>
                <div className="mt-5 grid gap-2 sm:grid-cols-3">
                  {contextItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.labelKey} className="edge-proof-context-card rounded-xl p-3">
                        <Icon className="h-4 w-4 edge-accent" />
                        <p className="edge-sans mt-3 text-[0.78rem] font-medium efg-85">
                          {t(item.labelKey)}
                        </p>
                        <p className="edge-mono mt-1 text-[0.62rem] efg-45">
                          {item.meta}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="edge-proof-lane rounded-2xl p-5">
              <div className="flex items-center justify-between gap-4">
                <span className="edge-label efg-35">{t("home_proof_outputs")}</span>
                <ArrowRight className="h-4 w-4 efg-45" />
              </div>
              <div className="mt-6 space-y-3">
                {outputItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.labelKey}
                      className="edge-proof-output-row flex items-center gap-3 rounded-xl p-3"
                    >
                      <div className="edge-proof-icon-box flex h-9 w-9 items-center justify-center rounded-lg">
                        <Icon className="h-4 w-4 efg-65" />
                      </div>
                      <span className="edge-sans text-[0.82rem] font-medium efg-80">
                        {t(item.labelKey)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="edge-proof-estimate mt-5 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <span className="edge-sans text-[0.76rem] efg-70">
                    {t("home_proof_estimate")}
                  </span>
                  <span className="edge-mono text-[0.76rem] efg-85">$0.009</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
