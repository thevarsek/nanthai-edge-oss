import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAction } from "convex/react";
import { useConvexAuth } from "convex/react";
import { api } from "@convex/_generated/api";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import {
  clearOAuthContext,
  postOAuthResult,
  providerLabel,
  readOAuthContext,
  type OAuthProvider,
} from "@/lib/providerOAuth";

type Status = "loading" | "success" | "error";
const AUTH_TIMEOUT_MS = 12000;

type GoogleExchangeAction = (args: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  requestedIntegration: "base" | "gmail" | "drive" | "calendar";
}) => Promise<unknown>;
type MicrosoftExchangeAction = (args: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) => Promise<unknown>;
type NotionExchangeAction = (args: { code: string; redirectUri: string }) => Promise<unknown>;

export function ProviderOAuthCallbackPage({ provider }: { provider: OAuthProvider }) {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [authDelayMessage, setAuthDelayMessage] = useState("");
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const didRun = useRef(false);
  const exchangeGoogleCode = useAction(api.oauth.google.exchangeGoogleCode) as GoogleExchangeAction;
  const exchangeMicrosoftCode = useAction(api.oauth.microsoft.exchangeMicrosoftCode) as MicrosoftExchangeAction;
  const exchangeNotionCode = useAction(api.oauth.notion.exchangeNotionCode) as NotionExchangeAction;
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const label = useMemo(() => providerLabel(provider), [provider]);

  useEffect(() => {
    if (status !== "loading" || isAuthLoading) {
      setAuthDelayMessage("");
      return;
    }
    if (isAuthenticated) {
      setAuthDelayMessage("");
      return;
    }
    const timer = window.setTimeout(() => {
      if (didRun.current) return;
      setAuthDelayMessage("Authentication is taking longer than expected. This window will keep trying automatically.");
    }, AUTH_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isAuthLoading, isAuthenticated, status]);

  useEffect(() => {
    // Wait until Convex is authenticated before exchanging the code.
    // ConvexProviderWithClerk may still be syncing the Clerk session token.
    if (isAuthLoading || !isAuthenticated || status !== "loading") return;
    if (didRun.current) return;
    didRun.current = true;

    async function complete() {
      const context = readOAuthContext(provider);
      const error = searchParams.get("error");
      const errorDescription = searchParams.get("error_description");
      if (error) {
        const message = errorDescription
          ? `${label} sign-in failed: ${errorDescription.replace(/\+/g, " ")}`
          : `${label} sign-in failed. Please try again.`;
        clearOAuthContext(provider);
        postOAuthResult({ type: "nanthai-oauth-result", provider, success: false, error: message });
        setErrorMessage(message);
        setStatus("error");
        return;
      }

      if (!context) {
        const message = `${label} sign-in has expired. Start the connection again.`;
        postOAuthResult({ type: "nanthai-oauth-result", provider, success: false, error: message });
        setErrorMessage(message);
        setStatus("error");
        return;
      }

      const code = searchParams.get("code");
      const returnedState = searchParams.get("state");
      if (!code || !returnedState) {
        clearOAuthContext(provider);
        const message = `${label} sign-in failed. Missing callback parameters.`;
        postOAuthResult({ type: "nanthai-oauth-result", provider, success: false, error: message });
        setErrorMessage(message);
        setStatus("error");
        return;
      }

      if (returnedState !== context.state) {
        clearOAuthContext(provider);
        const message = `${label} sign-in state mismatch. Please try again.`;
        postOAuthResult({ type: "nanthai-oauth-result", provider, success: false, error: message });
        setErrorMessage(message);
        setStatus("error");
        return;
      }

      try {
        if (provider === "notion") {
          await exchangeNotionCode({ code, redirectUri: context.redirectUri });
        } else {
          if (!context.verifier) {
            throw new Error(`${label} sign-in has expired. Start the connection again.`);
          }
          if (provider === "google") {
            await exchangeGoogleCode({
              code,
              codeVerifier: context.verifier,
              redirectUri: context.redirectUri,
              requestedIntegration: context.requestedIntegration ?? "base",
            });
          } else {
            await exchangeMicrosoftCode({
              code,
              codeVerifier: context.verifier,
              redirectUri: context.redirectUri,
            });
          }
        }

        clearOAuthContext(provider);
        postOAuthResult({ type: "nanthai-oauth-result", provider, success: true });
        setStatus("success");
        window.setTimeout(() => window.close(), 800);
      } catch (errorValue) {
        clearOAuthContext(provider);
        const message = errorValue instanceof Error ? errorValue.message : `${label} sign-in failed.`;
        postOAuthResult({ type: "nanthai-oauth-result", provider, success: false, error: message });
        setErrorMessage(message);
        setStatus("error");
      }
    }

    void complete();
  }, [exchangeGoogleCode, exchangeMicrosoftCode, exchangeNotionCode, isAuthLoading, isAuthenticated, label, provider, searchParams, status]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm text-center space-y-4">
        {status === "loading" && (
          <>
            <LoadingSpinner size="lg" className="mx-auto" />
            <p className="text-foreground/60 text-sm">{t("provider_oauth_connecting", { label, var1: label })}</p>
            {authDelayMessage ? (
              <p className="text-foreground/50 text-xs">{authDelayMessage}</p>
            ) : null}
          </>
        )}

        {status === "success" && (
          <>
            <div className="w-12 h-12 rounded-full bg-success/15 flex items-center justify-center mx-auto">
              <span className="text-success text-2xl">✓</span>
            </div>
            <h2 className="text-xl font-semibold text-foreground">{t("provider_oauth_connected", { label, var1: label })}</h2>
            <p className="text-foreground/55 text-sm">{t("provider_oauth_you_can_close")}</p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-12 h-12 rounded-full bg-destructive/12 flex items-center justify-center mx-auto">
              <span className="text-destructive text-2xl">✕</span>
            </div>
            <h2 className="text-xl font-semibold text-foreground">{t("provider_oauth_failed", { label, var1: label })}</h2>
            <p className="text-foreground/55 text-sm">{errorMessage}</p>
            <button
              onClick={() => window.close()}
              className="mt-2 px-4 py-2 rounded-lg border border-border text-sm text-secondary hover:text-foreground transition-colors"
            >
              {t("provider_oauth_close_window")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
