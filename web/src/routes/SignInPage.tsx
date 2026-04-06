import { SignIn } from "@clerk/clerk-react";
import { useTranslation } from "react-i18next";

/**
 * Sign-in page using Clerk's hosted UI.
 * Centered on a dark background matching the app theme.
 */
export function SignInPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      {/* Branding */}
      <div className="mb-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="text-2xl font-bold tracking-tight text-foreground">
            NanthAI
          </span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/25 leading-tight">
            Edge
          </span>
        </div>
        <p className="text-sm text-muted">
          {t("sign_in_to_continue")}
        </p>
      </div>

      {/* Clerk sign-in component */}
      <SignIn
        routing="path"
        path="/sign-in"
        appearance={{
          variables: {
            colorPrimary: "hsl(215, 100%, 70%)",
            colorBackground: "hsl(220, 15%, 10%)",
            colorText: "hsl(220, 30%, 96%)",
            colorTextSecondary: "rgba(200, 210, 230, 0.65)",
            colorInputBackground: "hsl(220, 15%, 13%)",
            colorInputText: "hsl(220, 30%, 96%)",
            colorNeutral: "hsl(220, 15%, 60%)",
            borderRadius: "10px",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif",
          },
          elements: {
            card: {
              background: "hsl(220, 15%, 8%)",
              border: "1px solid hsl(220, 15%, 18%)",
              boxShadow: "0 20px 60px -20px rgba(0,0,0,0.6)",
            },
            headerTitle: { display: "none" },
            headerSubtitle: { display: "none" },
            // Labels
            formFieldLabel: { color: "hsl(220, 30%, 82%)" },
            formFieldInput: {
              background: "hsl(220, 15%, 13%)",
              borderColor: "hsl(220, 15%, 22%)",
              color: "hsl(220, 30%, 96%)",
            },
            // Divider "or"
            dividerLine: { background: "hsl(220, 15%, 22%)" },
            dividerText: { color: "rgba(200, 210, 230, 0.5)" },
            // Social buttons
            socialButtonsBlockButton: {
              borderColor: "hsl(220, 15%, 22%)",
              background: "hsl(220, 15%, 13%)",
              color: "hsl(220, 30%, 90%)",
            },
            socialButtonsBlockButtonText: { color: "hsl(220, 30%, 90%)" },
            // Footer links ("Don't have an account?")
            footerActionLink: { color: "hsl(215, 100%, 70%)" },
            footerActionText: { color: "rgba(200, 210, 230, 0.55)" },
            // "Secured by Clerk"
            footer: { color: "rgba(200, 210, 230, 0.4)" },
          },
        }}
      />
    </div>
  );
}
