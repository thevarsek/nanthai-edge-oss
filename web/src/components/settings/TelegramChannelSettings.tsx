import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { convexErrorMessage } from "@/lib/convexErrors";
import { SettingsSection, SettingsRow } from "./SettingsHelpers";
import { TelegramConversationEditor, telegramActionClass } from "./TelegramConversationEditor";

export function TelegramChannelSettings() {
  const { t } = useTranslation();
  const status = useQuery(api.channels.linking.status, {});
  const personas = useQuery(api.personas.queries.list, {});
  const begin = useMutation(api.channels.linking.begin);
  const confirm = useMutation(api.channels.linking.confirm);
  const select = useMutation(api.channels.linking.selectConversation);
  const disconnect = useMutation(api.channels.linking.disconnect);
  const resend = useMutation(api.channels.delivery_mutations.resend);
  const retryInput = useMutation(api.channels.controls.retryInput);
  const [url, setUrl] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function perform(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await action(); } catch (failure) { setError(convexErrorMessage(failure, t("tg_failure"))); }
    finally { setBusy(false); }
  }
  const identity = status?.identities[0];
  const binding = status?.bindings.find(item => item.identityId === identity?._id);
  const secondary = `${telegramActionClass} bg-surface-2 hover:bg-surface-3`;
  return <section id="telegram" className="space-y-6" aria-label="Telegram">
    <p className="text-sm text-muted leading-relaxed">{t("tg_description")}</p>
    {status?.botUsername && <p className="text-sm">{t("tg_bot_label")} <a className="text-primary hover:underline" href={`https://t.me/${status.botUsername}`} target="_blank" rel="noreferrer">@{status.botUsername}</a></p>}
    {!status ? <p role="status" className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" />{t("loading")}</p>
      : !status.configured ? <p className="text-sm text-muted">{t("tg_status_unconfigured")}</p> : <>
      {!identity && <SettingsSection header={t("tg_step_link")} footer={t("tg_private_accounts")}>
        <div className="p-4 space-y-3">
          {status.grants.length > 0 ? status.grants.map(grant => <div className="space-y-3" key={grant.id}>
            <p className="text-sm">{t("tg_return_confirm", {name: grant.claimantName || "Telegram"})}</p>
            <button disabled={busy} type="button" className={`${telegramActionClass} bg-primary text-white hover:bg-primary-hover`} onClick={() => void perform(() => confirm({grantId: grant.id}))}>{t("tg_confirm")}</button>
          </div>) : url ? <>
            <a href={url} target="_blank" rel="noreferrer" className={`${telegramActionClass} bg-primary text-white`}><ExternalLink size={16} />{t("tg_open_bot")}</a>
            <p role="status" className="text-sm text-muted">{t("tg_wait_claim")}</p>
            <button type="button" className="text-sm text-primary" disabled={busy} onClick={() => void perform(async () => {setUrl((await begin({})).url);})}>{t("tg_connect")}</button>
          </> : <button disabled={busy} type="button" className={`${telegramActionClass} bg-primary text-white hover:bg-primary-hover`} onClick={() => void perform(async () => {setUrl((await begin({})).url);})}>{t("tg_connect")}</button>}
        </div>
      </SettingsSection>}
      {identity && <>
        <SettingsSection footer={t("tg_private_accounts")}>
          <SettingsRow><Check size={18} className="text-primary shrink-0" /><span className="text-sm">{t("tg_account_confirmed")}</span></SettingsRow>
          {binding && <>
            <SettingsRow><span className="flex-1 text-sm text-muted">{t("participants")}</span><span className="text-sm font-medium">{status.connectedParticipants?.map(participant => participant.name).join(", ") ?? status.connectedPersonaName ?? ""}</span></SettingsRow>
            <SettingsRow><span className="flex-1 text-sm text-muted">{t("tg_conversation")}</span><span className="min-w-0 text-sm font-medium truncate">{status.connectedChatTitle ?? t("tg_conversation")}</span></SettingsRow>
          </>}
        </SettingsSection>
        {binding && !editing && <div className="flex flex-wrap gap-2">
          <Link to={`/app/chat/${binding.chatId}`} className={`${telegramActionClass} bg-primary text-white`}>{t("tg_open_conversation")}</Link>
          <button type="button" disabled={busy} className={secondary} onClick={() => setEditing(true)}>{t("tg_change")}</button>
        </div>}
        {(!binding || editing) && personas && <TelegramConversationEditor key={binding?._id ?? identity._id}
          initialPersonaId={binding?.personaId} initialChatId={binding?.chatId} activeChatTitle={status.connectedChatTitle}
          personas={personas} busy={busy} onCancel={binding ? () => setEditing(false) : undefined}
          onSave={async (personaId, chatId) => {await perform(async () => {await select({identityId: identity._id, personaId, chatId, deliverFutureReplies: true});setEditing(false);});}} />}
        <button type="button" disabled={busy} className={`${telegramActionClass} text-destructive hover:bg-surface-2`} onClick={() => void perform(() => disconnect({identityId: identity._id}))}>{t("tg_disconnect")}</button>
      </>}
      {(status.inbox.some(item => item.status === "failed") || status.deliveries.some(item => ["failed", "unknown", "retry"].includes(item.status))) && <SettingsSection header={t("tg_attention")}>
        {status.inbox.filter(item => item.status === "failed").map(item => <div className="p-4 space-y-2" key={item.id}><p className="text-sm font-medium">{[item.chatTitle, item.fileNames?.join(", ")].filter(Boolean).join(" · ")}</p><p className="text-sm">{item.error}</p><button disabled={busy} type="button" className={secondary} onClick={() => void perform(() => retryInput({inboxId: item.id}))}>{t("tg_retry_input")}</button></div>)}
        {status.deliveries.filter(item => ["failed", "unknown", "retry"].includes(item.status)).map(item => <div className="p-4 space-y-2" key={item.id}><p className="text-sm">{t("tg_part_status", {part: item.part + 1, status: t(`tg_delivery_${item.status}`)})} {item.error}</p>{item.status !== "retry" && <button disabled={busy} type="button" className={secondary} onClick={() => void perform(() => resend({deliveryId: item.id, acknowledgeDuplicateRisk: item.status === "unknown"}))}>{t(item.status === "unknown" ? "tg_unknown_resend" : "tg_retry_delivery")}</button>}</div>)}
      </SettingsSection>}
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
