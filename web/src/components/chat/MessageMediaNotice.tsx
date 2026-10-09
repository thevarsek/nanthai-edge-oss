import { useTranslation } from "react-i18next";

export function MessageMediaNotice({ notice }: {notice?: string | null}) {
  const { t } = useTranslation();
  if (!notice) return null;
  return <p role="status" className="px-4 py-2 text-xs leading-relaxed text-muted">{t(`media_notice_${notice}`, {defaultValue: t("media_notice_input_preparation_failed")})}</p>;
}
