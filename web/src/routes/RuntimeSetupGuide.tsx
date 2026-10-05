import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useTranslation } from "react-i18next";

export function RuntimeSetupGuide() {
  const { t } = useTranslation();
  const summary = useQuery(api.runtime_host.connection_summary.getMySummary, {});
  return <section className="space-y-5">
    <h2 className="text-xl font-semibold">{t("runtime_preview_setup_heading")}</h2>
    <ol className="space-y-5 list-decimal pl-5 marker:text-muted">
      <li className="pl-2">
        <h3 className="font-medium">{t("runtime_install_heading")}</h3>
        <p className="mt-1 text-sm text-secondary">{t("runtime_install_help")}</p>
        {summary?.downloadUrl && <a href={summary.downloadUrl} className="mt-2 inline-block text-primary underline underline-offset-4">{t("runtime_download_mac")}</a>}
      </li>
      <li className="pl-2">
        <h3 className="font-medium">{t("runtime_pair_computer_heading")}</h3>
        <p className="mt-1 text-sm text-secondary">{t("runtime_pair_computer_help")}</p>
      </li>
      <li className="pl-2">
        <h3 className="font-medium">{t("runtime_start_heading")}</h3>
        <p className="mt-1 text-sm text-secondary">{t("runtime_start_help")}</p>
      </li>
      <li className="pl-2">
        <h3 className="font-medium">{t("runtime_first_chat_heading")}</h3>
        <p className="mt-1 text-sm text-secondary">{t("runtime_preview_auto_persona")}</p>
      </li>
    </ol>
  </section>;
}
