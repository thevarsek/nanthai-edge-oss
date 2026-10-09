import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { convexErrorMessage } from "@/lib/convexErrors";
import { TeamWorkEditor } from "./TeamWorkEditor";
import { TeamExecutionSettings } from "./TeamExecutionSettings";
import { TeamGoalRow } from "./TeamGoalRow";

export function TeamWorkBoard({ chatId, embedded = false, onStarted }: { chatId: Id<"chats">; embedded?: boolean; onStarted?: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (embedded) return <GoalContent chatId={chatId} onStarted={onStarted} />;
  return <div className="px-4 py-1">
    <button className="text-sm text-muted hover:text-foreground" onClick={() => setOpen(!open)} aria-expanded={open}>{t("cw_control")}</button>
    {open && <GoalContent chatId={chatId} onStarted={onStarted} />}
  </div>;
}
function GoalContent({ chatId, onStarted }: { chatId: Id<"chats">; onStarted?: () => void }) {
  const { t } = useTranslation();
  const board = useQuery(api.collaboration.work_context.getBoard, { chatId });
  const resume = useMutation(api.collaboration.work_control.continueWork);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Id<"collaborationWork"> | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const continueGoals = async () => {
    setBusy(true); setError(null);
    try { await resume({ chatId }); onStarted?.(); } catch (caught) { setError(convexErrorMessage(caught, t("cw_failure"))); }
    finally { setBusy(false); }
  };
  if (!board) return <p className="text-sm text-muted">{t("cw_loading")}</p>;
  return <section aria-label={t("cw_title")} className="space-y-5 border-t border-border/50 pt-5">
    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{t("cw_title")}</h3>
      {!editing && <button className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40" disabled={busy} onClick={() => setEditing("new")}>{t("cw_add")}</button>}
    </div>
    {editing && <TeamWorkEditor key={editing} chatId={chatId} board={board} work={board.work.find(row => row._id === editing)} onClose={() => setEditing(null)} onError={setError} onStarted={onStarted} />}
    {!editing && !board.work.length && <p className="text-sm text-muted">{t("cw_empty")}</p>}
    {!editing && <div className="divide-y divide-border/50">{board.work.map(work => <TeamGoalRow key={work._id} work={work} board={board} onEdit={() => setEditing(work._id)} onError={setError} onStarted={onStarted} />)}</div>}
    {!editing && board.canResume && <button disabled={busy} onClick={() => void continueGoals()} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40">{t("cw_continue")}</button>}
    <TeamExecutionSettings chatId={chatId} settings={board.settings} onError={setError} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
