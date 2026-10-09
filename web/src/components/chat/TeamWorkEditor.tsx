import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { MenuSelect } from "@/components/shared/MenuSelect";
import { convexErrorMessage } from "@/lib/convexErrors";

type Board = FunctionReturnType<typeof api.collaboration.work_context.getBoard>;
export function TeamWorkEditor({ chatId, board, work, onClose, onError, onStarted }: {
  chatId: Id<"chats">; board: Board; work?: Board["work"][number];
  onStarted?: () => void; onClose: () => void; onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const create = useMutation(api.collaboration.work_mutations.createWork);
  const revise = useMutation(api.collaboration.work_mutations.reviseWork);
  const [objective, setObjective] = useState(work?.objective ?? "");
  const [criteria, setCriteria] = useState(work?.acceptanceCriteria.join("\n") ?? "");
  const [assignee, setAssignee] = useState(work?.assigneeId ?? "");
  const [reviewers, setReviewers] = useState(work?.reviewerIds ?? []);
  const [dependencies, setDependencies] = useState(work?.dependencyIds ?? []);
  const [readOnlyReview, setReadOnlyReview] = useState(work?.readOnlyReview ?? false);
  const [busy, setBusy] = useState(false);
  const save = async (start = false) => {
    setBusy(true);
    const values = { objective, acceptanceCriteria: criteria.trim() ? [criteria] : [],
      assigneeId: assignee ? assignee as Id<"chatParticipants"> : undefined,
      reviewerIds: reviewers, dependencyIds: dependencies, readOnlyReview };
    try {
      if (work) await revise({ workId: work._id, revision: work.revision, ...values });
      else await create({ chatId, start, ...values });
      onClose();
      if (start) onStarted?.();
    } catch (caught) { onError(convexErrorMessage(caught, "Could not save work.")); }
    finally { setBusy(false); }
  };
  return <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
    <label className="block text-sm sm:col-span-2">{t("cw_objective")}<textarea rows={2} placeholder={t("cw_objective_hint")} className="mt-1 block w-full rounded-xl bg-surface-2 px-3 py-2" value={objective} onChange={event => setObjective(event.target.value)} /></label>
    <label className="block text-sm sm:col-span-2">{t("cw_criteria")}<textarea rows={3} placeholder={t("cw_criteria_hint")} className="mt-1 block w-full rounded-xl bg-surface-2 px-3 py-2" value={criteria} onChange={event => setCriteria(event.target.value)} /></label>
    <details className="sm:col-span-2 text-sm"><summary className="cursor-pointer text-primary">{t("cw_assignment")}</summary>
      <div className="mt-3 space-y-3"><label className="flex items-center justify-between gap-3">{t("cw_owner")}<MenuSelect searchable ariaLabel={t("cw_owner")} value={assignee} onChange={setAssignee} options={[{ value: "", label: t("cw_unassigned") }, ...board.participants.map(row => ({ value: row.id, label: row.name }))]} /></label>
        <p className="text-xs text-muted">{t("cw_reviewers")}</p>
        <div className="flex flex-wrap gap-4">{board.participants.map(row => <label key={row.id} className="inline-flex items-center gap-2"><input type="checkbox" checked={reviewers.includes(row.id)} onChange={event => setReviewers(event.target.checked ? [...reviewers, row.id] : reviewers.filter(id => id !== row.id))} />{row.name}</label>)}</div>
        <details className="text-xs"><summary>{t("cw_advanced")}</summary><label className="mt-2 flex gap-2"><input type="checkbox" checked={readOnlyReview} onChange={event => setReadOnlyReview(event.target.checked)} />{t("cw_read_only")}</label><p className="mt-2 text-muted">{t("cw_read_only_note")}</p></details>
        {board.work.some(row => row._id !== work?._id) && <details className="text-xs"><summary>{t("cw_dependencies")}</summary>{board.work.filter(row => row._id !== work?._id).map(row => <label key={row._id} className="mt-2 flex gap-2"><input type="checkbox" checked={dependencies.includes(row._id)} onChange={event => setDependencies(event.target.checked ? [...dependencies, row._id] : dependencies.filter(id => id !== row._id))} />{row.objective}</label>)}</details>}
      </div>
    </details>
    <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
      <button disabled={!objective.trim()} onClick={() => void save(!work)} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40">{t(work ? "cw_save" : "cw_start")}</button>
      {!work && <button disabled={!objective.trim()} onClick={() => void save()} className="text-sm text-primary disabled:opacity-40">{t("cw_save_later")}</button>}
      <button onClick={onClose} className="ml-auto text-sm text-muted hover:text-foreground">{t("cw_cancel_edit")}</button>
    </div>
  </fieldset>;
}
