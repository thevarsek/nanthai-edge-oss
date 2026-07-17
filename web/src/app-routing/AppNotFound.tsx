import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

interface AppNotFoundProps {
  homeTarget?: string;
}

export function AppNotFound({ homeTarget = "/" }: AppNotFoundProps) {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground gap-4">
      <h1 className="text-5xl font-bold text-foreground/20">404</h1>
      <p className="text-lg text-foreground/60">
        {t("page_not_found", "Page not found")}
      </p>
      <Link to={homeTarget} className="text-sm text-primary hover:underline">
        {t("go_home", "Go home")}
      </Link>
    </div>
  );
}
