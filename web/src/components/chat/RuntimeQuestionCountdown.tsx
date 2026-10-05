import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function RuntimeQuestionCountdown({ deadline, automatic }: { deadline?: number; automatic?: boolean }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (deadline === undefined || automatic) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadline, automatic]);
  if (automatic) return <p role="status" className="mt-2 text-xs text-muted">{t("runtime_question_automatic")}</p>;
  if (deadline === undefined) return null;
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return <p className="mt-2 text-xs text-muted">{t(seconds ? "runtime_question_countdown" : "runtime_question_delivering", { time })}</p>;
}
