import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { MenuSelect } from "@/components/shared/MenuSelect";
import { convexErrorMessage } from "@/lib/convexErrors";
import { TeamWorkEvidence } from "./TeamWorkEvidence";
type Board = FunctionReturnType<typeof api.collaboration.work_context.getBoard>;
type ReviewRevision = Pick<Board["work"][number], "revision" | "requirementRevision" | "evidenceRevision"> & { sourceRevision: string };
function reviewRevision(work: Board["work"][number]): ReviewRevision {
  return { revision: work.revision, requirementRevision: work.requirementRevision,
    evidenceRevision: work.evidenceRevision, sourceRevision: work.sourceRevision ?? "" };
}
export function TeamGoalRow({ work, board, onEdit, onError, onStarted }: { work: Board["work"][number]; board: Board; onEdit: () => void; onError: (text: string) => void; onStarted?: () => void }) {
  const { t } = useTranslation();
  const release = useMutation(api.collaboration.work_mutations.releaseWork);
  const start = useMutation(api.collaboration.work_control.continueWork);
  const review = useMutation(api.collaboration.work_reviews.reviewWork);
  const [evidence, setEvidence] = useState<{ messageId: (typeof work.evidence)[number]["messageId"]; revision: ReviewRevision } | null>(null);
  const [draft, setDraft] = useState<{ reason: string; revision: ReviewRevision } | null>(null);
  const reason = draft?.reason ?? "";
  const evidenceCurrent = evidence && evidence.revision.requirementRevision === work.requirementRevision
    && evidence.revision.evidenceRevision === work.evidenceRevision && evidence.revision.sourceRevision === (work.sourceRevision ?? "");
  const [busy, setBusy] = useState(false);
  const active = work.status !== "done" && work.status !== "cancelled";
  const action = async (value: string) => {
    if (value === "edit") { onEdit(); return; }
    if (!value) return;
    setBusy(true);
    try { if (value === "start") { await start({ chatId: work.chatId, workId: work._id }); onStarted?.(); return; }
      await release({ workId: work._id, revision: work.revision, cancel: value === "cancel", start: value === "retry", reason: value === "cancel" ? "Cancelled by owner" : "Explicit owner retry" }); if (value === "retry") onStarted?.(); }
    catch (error) { onError(convexErrorMessage(error, t("cw_failure"))); } finally { setBusy(false); }
  };
  const decide = async (outcome: "accept" | "rework" | "override") => {
    setBusy(true);
    try { await review({ workId: work._id, ...(draft?.revision ?? reviewRevision(work)), outcome, reason }); }
    catch (error) { onError(convexErrorMessage(error, t("cw_failure"))); } finally { setBusy(false); }
  };
  const owner = board.participants.find(row => row.id === work.assigneeId)?.name ?? t("cw_unassigned");
  return <article className="py-4 space-y-3">
    <div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-sm font-medium break-words">{work.objective}</p>
      <p className="mt-1 text-xs text-muted">{owner} · {t(`cw_state_${work.displayStatus ?? work.status}`, { defaultValue: work.status })}</p></div>
      <div className="shrink-0"><MenuSelect ariaLabel={t("cw_actions")} value="" onChange={value => void action(value)} disabled={busy} options={[
        { value: "", label: t("cw_actions") }, ...(work.displayStatus === "saved" || work.displayStatus === "paused" ? [{ value: "start", label: t("cw_start_goal") }] : []), { value: "edit", label: t("cw_edit") },
        ...(active ? [{ value: "retry", label: t("cw_retry") }, { value: "cancel", label: t("cw_cancel") }] : []),
      ]} /></div>
    </div>
    {!work.dependenciesReady && <p className="text-xs text-muted">{t("cw_waiting")}</p>}
    {work.status === "blocked" && work.blocker && <p className="text-xs">{work.blocker}</p>}
    {work.needsRevalidation && <p className="text-xs">{t("cw_revalidation")}</p>}
    {work.evidence.map(item => <button key={item.messageId} onClick={() => setEvidence({ messageId: item.messageId, revision: reviewRevision(work) })} className="text-sm text-primary hover:underline text-left">{t("cw_view_result")}</button>)}
    <details className="text-xs text-muted"><summary className="cursor-pointer">{t("cw_details")}</summary>
      {work.status !== "blocked" && work.blocker && <p className="mt-2">{work.blocker}</p>}
      <p className="mt-2 whitespace-pre-wrap">{work.acceptanceCriteria.join("\n")}</p>
      <p className="mt-2">{t("cw_revision_summary", { requirements: work.requirementRevision, evidence: work.evidenceRevision })}</p>
      {work.evidence.map(item => <p key={item.messageId}>{item.description} · {item.sourceRevision}</p>)}
    </details>
    {evidence && evidenceCurrent && <TeamWorkEvidence messageId={evidence.messageId} onClose={() => setEvidence(null)} />}
    {work.status === "review" && work.evidence.length > 0 && <div className="space-y-2">
      <label className="block text-sm">{t("cw_reason")}<textarea className="mt-1 w-full rounded-xl bg-surface-2 px-3 py-2" value={reason} onChange={event => setDraft(event.target.value ? { reason: event.target.value, revision: draft?.revision ?? reviewRevision(work) } : null)} /></label>
      <div className="flex gap-3"><button disabled={busy || !reason.trim()} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40" onClick={() => void decide(work.needsRevalidation ? "override" : "accept")}>{t(work.needsRevalidation ? "cw_override" : "cw_accept")}</button>
        <button disabled={busy || !reason.trim()} className="text-sm text-primary disabled:opacity-40" onClick={() => void decide("rework")}>{t("cw_rework")}</button></div>
    </div>}
  </article>;
}
