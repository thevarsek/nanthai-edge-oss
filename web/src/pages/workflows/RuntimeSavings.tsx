import { useTranslation } from "react-i18next";
import { AnimateOnScroll } from "@/pages/features/illustrations/IllustrationPrimitives";
import savings from "./savings.json";

export function RuntimeSavings() {
  const { t, i18n } = useTranslation();
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(value);
  return <section id="savings" className="scroll-mt-24 mt-16 border-t eborder-12 pt-12" aria-labelledby="savings-title">
    <AnimateOnScroll><h2 id="savings-title" className="edge-display max-w-4xl text-[clamp(2.3rem,5vw,4.5rem)] uppercase leading-[1.08] efg-heading">{t("runtime_savings_title")}</h2>
    <p className="mt-5 max-w-3xl text-lg leading-relaxed efg-70">{t("runtime_savings_intro")}</p>
    </AnimateOnScroll>
    <div className="mt-8 grid gap-8 sm:grid-cols-2">
      {[["input", savings.inputReductionPercent], ["cost", savings.estimatedCostReductionPercent]].map(([metric, reduction]) => <figure key={metric} className="border-l-2 border-orange-500 pl-6">
        <figcaption className="text-sm efg-70">{t(`runtime_savings_${metric}`)}</figcaption>
        <p className="edge-display mt-2 text-6xl efg-heading"><span className="mr-3 text-xl">{t("runtime_savings_up_to")}</span>{number(Number(reduction))}%</p>
        <div className="mt-4 space-y-3 text-sm efg-60">
          <p>{t("runtime_savings_standalone")} · 100%</p><div aria-hidden="true"><AnimateOnScroll animation="edge-bar-grow" className="h-3 rounded-full bg-slate-400">{null}</AnimateOnScroll></div>
          <p>{t("runtime_savings_nanthai")} · {number(100 - Number(reduction))}%</p><div aria-hidden="true" style={{ width: `${100 - Number(reduction)}%` }}><AnimateOnScroll animation="edge-bar-grow" delay={0.12} className="h-3 rounded-full bg-orange-500">{null}</AnimateOnScroll></div>
        </div>
      </figure>)}
    </div>
    <p className="mt-6 max-w-3xl text-sm leading-relaxed efg-60">{t("runtime_savings_note")}</p>
  </section>;
}
