import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { convexErrorMessage } from "@/lib/convexErrors";

interface Settings { durationMinutes: number; maxWaves: number; maxPublicReplies: number; consensusAutoStop: boolean }
export function TeamExecutionSettings({ chatId, settings, onError }: {
  chatId: Id<"chats">; settings: Settings; onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);
  const update = useMutation(api.collaboration.work_mutations.setSettings);
  const save = async () => {
    try { await update({ chatId, settings: draft }); setSaved(true); }
    catch (caught) { onError(convexErrorMessage(caught, t("cw_failure"))); }
  };
  return <details>
    <summary className="cursor-pointer text-sm text-muted">{t("cw_advanced")}</summary>
    <div className="grid gap-3 pt-3 text-sm sm:grid-cols-3">
      <p className="text-xs text-muted sm:col-span-3">{t("cw_limit_note")}</p>
      {(["durationMinutes", "maxWaves", "maxPublicReplies"] as const).map((key, index) => <label key={key} className="block">{[t("cw_duration"), t("cw_waves"), t("cw_replies")][index]}<input className="mt-1 block w-full rounded-lg bg-surface-2 px-3 py-2" type="number" min="1" value={draft[key]} onChange={(event) => { setSaved(false); setDraft({ ...draft, [key]: Number(event.target.value) }); }} /></label>)}
      <label className="flex items-center gap-2 sm:col-span-3"><input type="checkbox" checked={draft.consensusAutoStop} onChange={(event) => { setSaved(false); setDraft({ ...draft, consensusAutoStop: event.target.checked }); }} />{t("cw_consensus")}</label>
      <button className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => void save()}>{t("cw_save_limits")}</button>
      {saved && <p role="status" className="text-xs text-primary sm:col-span-2">{t("cw_saved")}</p>}
    </div>
  </details>;
}
