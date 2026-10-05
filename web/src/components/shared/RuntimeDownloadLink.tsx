import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { safeDownloadUrl } from "@/components/chat/GeneratedFileDownloadUrl";

export function RuntimeDownloadLink({ className, fallbackToSetup = false }: { className?: string; fallbackToSetup?: boolean }) {
  const { t } = useTranslation();
  const downloadUrl = safeDownloadUrl(import.meta.env.VITE_NANTHAI_RUNTIME_HOST_DOWNLOAD_URL);
  if (downloadUrl) return <a href={downloadUrl} className={className}>{t("local_work_download")}</a>;
  return fallbackToSetup ? <Link to="/app/settings/local-runtime" className={className}>{t("local_work_start")}</Link> : null;
}
