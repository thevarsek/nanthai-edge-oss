import { useState } from "react";
import { useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { MenuSelect } from "@/components/shared/MenuSelect";

type Choice = { _id: Id<"chats">; title?: string };
export function TelegramConversationPicker({ value, onChange, disabled, activeTitle }: {
  value: string; onChange: (value: string) => void; disabled: boolean; activeTitle?: string;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [beforeChatId, setBefore] = useState<Id<"chats">>();
  const [previous, setPrevious] = useState<Choice[]>([]);
  const page = useQuery(api.chat.queries.listChats, { order: "created", limit: 21, searchQuery: search, beforeChatId });
  const choices = [...previous, ...(page ?? []).slice(0, 20)];
  const options = [{ value: "", label: t("tg_new_conversation") }, ...choices.map(chat => ({ value: chat._id, label: chat.title ?? t("tg_conversation") }))];
  if (value && !options.some(option => option.value === value)) options.push({ value, label: activeTitle ?? t("tg_conversation") });
  return <MenuSelect searchable ariaLabel={t("tg_pick_conversation")} disabled={disabled} value={value} options={options} onChange={onChange}
    searchValue={search} onSearch={next => { setSearch(next); setBefore(undefined); setPrevious([]); }}
    onLoadMore={page && page.length > 20 ? () => { setPrevious(choices); setBefore(choices.at(-1)?._id); } : undefined} />;
}
