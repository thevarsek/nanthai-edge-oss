import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { remoteMcpErrorMessage } from "@/lib/remoteMcpErrors";

export function RemoteMcpOAuthCallbackPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const completeOAuth = useAction(api.mcp.oauth_actions.completeOAuth);
  const refreshCatalog = useAction(api.mcp.actions.refreshCatalog);
  const started = useRef(false);
  const callbackIsInvalid = Boolean(searchParams.get("error"))
    || !searchParams.get("code")
    || !searchParams.get("state");
  const [state, setState] = useState<"working" | "complete" | "error">(
    callbackIsInvalid ? "error" : "working",
  );
  const [message, setMessage] = useState(
    callbackIsInvalid
      ? t("remote_mcp_oauth_declined_or_incomplete")
      : t("remote_mcp_oauth_completing"),
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const oauthError = searchParams.get("error");
    const code = searchParams.get("code");
    const callbackState = searchParams.get("state");
    if (oauthError || !code || !callbackState) return;
    void (async () => {
      try {
        const result = await completeOAuth({
          code,
          state: callbackState,
          issuer: searchParams.get("iss") ?? undefined,
        });
        await refreshCatalog({ connectionId: result.connectionId });
        setState("complete");
        setMessage(t("remote_mcp_oauth_connected"));
        window.setTimeout(() => navigate("/app/settings/remote-mcp", { replace: true }), 900);
      } catch (error) {
        setState("error");
        setMessage(remoteMcpErrorMessage(error, t, t("remote_mcp_oauth_failed")));
      }
    })();
  }, [completeOAuth, navigate, refreshCatalog, searchParams, t]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-secondary p-7 text-center shadow-xl">
        {state === "working" && <Loader2 size={34} className="mx-auto animate-spin text-primary" />}
        {state === "complete" && <CheckCircle2 size={34} className="mx-auto text-green-500" />}
        {state === "error" && <XCircle size={34} className="mx-auto text-red-500" />}
        <h1 className="mt-4 text-lg font-semibold">{t("remote_mcp_oauth_title")}</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{message}</p>
        {state === "error" && (
          <button type="button" onClick={() => navigate("/app/settings/remote-mcp", { replace: true })} className="mt-5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white">
            {t("remote_mcp_return_to_servers")}
          </button>
        )}
      </div>
    </main>
  );
}
