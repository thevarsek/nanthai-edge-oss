import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { api } from "@convex/_generated/api";
import { convexErrorMessage } from "@/lib/convexErrors";

export function RuntimeQuestionSettings() {
  const { t } = useTranslation();
  const summary = useQuery(api.runtime_host.connection_summary.getMySummary, {});
  const save = useMutation(api.preferences.mutations.upsertPreferences);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function update(value: string) {
    setBusy(true); setError(undefined);
    try { await save({ localQuestionTimeoutMinutes: Number(value) as 0 | 5 | 10 | 15 }); }
    catch (cause) { setError(convexErrorMessage(cause, t("runtime_question_save_failed"))); }
    finally { setBusy(false); }
  }
  return <section className="rounded-2xl bg-surface-2 p-5 space-y-3">
    <label htmlFor="runtime-question-timeout" className="block font-semibold">{t("runtime_question_setting")}</label>
    <p className="text-sm text-muted">{t("runtime_question_help")}</p>
    <select id="runtime-question-timeout" className="rounded-lg border border-border bg-background px-3 py-2"
      value={summary?.questionTimeoutMinutes ?? ""} disabled={!summary || busy} onChange={event => void update(event.target.value)}>
      {!summary && <option value="">{t("loading")}</option>}
      {[5, 10, 15].map(minutes => <option key={minutes} value={minutes}>{t("runtime_question_minutes", { count: minutes })}</option>)}
      <option value={0}>{t("runtime_question_never")}</option>
    </select>
    <p className="text-xs text-muted">{t("runtime_question_never_help")}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
