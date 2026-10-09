import { TelegramConversationPicker } from "./TelegramConversationPicker";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Id } from "@convex/_generated/dataModel";
import { MenuSelect } from "@/components/shared/MenuSelect";
import { SettingsSection, SettingsRow } from "./SettingsHelpers";

export const telegramActionClass = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40 disabled:cursor-not-allowed";

type Props = {
  initialPersonaId?: string;
  initialChatId?: string;
  activeChatTitle?: string;
  personas: { _id: Id<"personas">; displayName: string }[];
  busy: boolean;
  onSave: (personaId: Id<"personas"> | undefined, chatId?: Id<"chats">) => Promise<void>;
  onCancel?: () => void;
};

export function TelegramConversationEditor(props: Props) {
  const { t } = useTranslation();
  const [personaId, setPersonaId] = useState(props.initialPersonaId ?? "");
  const [chatId, setChatId] = useState(props.initialChatId ?? "");
  const changed = personaId !== (props.initialPersonaId ?? "") || chatId !== (props.initialChatId ?? "");
  return <div className="space-y-4">
    <SettingsSection header={t("tg_step_conversation")}>
      {!chatId && <SettingsRow><span className="flex-1 text-sm">{t("tg_starter")}</span>
        <MenuSelect ariaLabel={t("tg_persona")} disabled={props.busy} value={personaId}
          options={[{value: "", label: t("tg_defaults")}, ...props.personas.map(persona => ({value: persona._id, label: persona.displayName}))]}
          onChange={value => { setPersonaId(value); setChatId(""); }} />
      </SettingsRow>}
      <SettingsRow><span className="flex-1 text-sm">{t("tg_pick_conversation")}</span>
        <TelegramConversationPicker disabled={props.busy} value={chatId} onChange={setChatId} activeTitle={props.activeChatTitle} />
      </SettingsRow>
    </SettingsSection>
    <p className="text-sm text-muted leading-relaxed">{t("tg_connection_notice")}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={`${telegramActionClass} bg-primary text-white hover:bg-primary-hover`} disabled={props.busy || (Boolean(props.initialChatId) && !changed)}
        onClick={() => void props.onSave(!chatId && personaId ? personaId as Id<"personas"> : undefined, chatId ? chatId as Id<"chats"> : undefined)}>{t(props.busy ? "loading" : chatId ? "tg_connect_conversation" : "tg_create_connect")}</button>
      {props.onCancel && <button type="button" className={`${telegramActionClass} bg-surface-2 hover:bg-surface-3`} disabled={props.busy} onClick={props.onCancel}>{t("cancel")}</button>}
    </div>
  </div>;
}
