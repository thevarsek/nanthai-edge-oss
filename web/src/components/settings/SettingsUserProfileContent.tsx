import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useUser } from "@clerk/react";
import { Camera, Mail, Link as LinkIcon } from "lucide-react";

// ─── User Profile ──────────────────────────────────────────────────────────

function formatProviderName(provider: string): string {
  const stripped = provider.startsWith("oauth_") ? provider.slice(6) : provider;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export function SettingsUserProfileContent() {
  const { t } = useTranslation();
  const { user } = useUser();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePhotoUpload = useCallback(async (file: File) => {
    if (!user) return;
    setIsUploading(true);
    setErrorMessage(null);
    try {
      await user.setProfileImage({ file });
    } catch (err) {
      setErrorMessage(t("upload_failed_arg", { var1: err instanceof Error ? err.message : "Unknown error" }));
    } finally {
      setIsUploading(false);
    }
  }, [user, t]);

  const handleRemovePhoto = useCallback(async () => {
    if (!user) return;
    setIsUploading(true);
    setErrorMessage(null);
    try {
      await user.setProfileImage({ file: null });
    } catch (err) {
      setErrorMessage(t("remove_failed_arg", { var1: err instanceof Error ? err.message : "Unknown error" }));
    } finally {
      setIsUploading(false);
    }
  }, [user, t]);

  if (!user) return null;

  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  const primaryEmail = user.primaryEmailAddress?.emailAddress;
  const emails = user.emailAddresses ?? [];
  const externalAccounts = user.externalAccounts ?? [];

  // Deduplicate external accounts by provider
  const seenProviders = new Set<string>();
  const uniqueAccounts = externalAccounts.filter((a) => {
    if (seenProviders.has(a.provider ?? "")) return false;
    seenProviders.add(a.provider ?? "");
    return true;
  });

  const initial = displayName
    ? displayName.charAt(0).toUpperCase()
    : primaryEmail?.charAt(0).toUpperCase() ?? "?";

  return (
    <div className="space-y-6">
      {/* Profile section */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted uppercase tracking-wide px-1">{t("profile_section")}</p>
        <div className="rounded-2xl bg-surface-2 overflow-hidden">
          <div className="flex flex-col items-center py-6 px-4">
            {/* Avatar with camera badge */}
            <div className="relative group">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="relative"
              >
                {isUploading ? (
                  <div className="w-20 h-20 rounded-full bg-surface-3 flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : user.imageUrl ? (
                  <img
                    src={user.imageUrl}
                    alt={displayName || "Profile"}
                    className="w-20 h-20 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-surface-3 flex items-center justify-center">
                    <span className="text-2xl font-semibold text-muted">{initial}</span>
                  </div>
                )}
                {/* Camera badge */}
                <div className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                  <Camera size={12} className="text-white" />
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handlePhotoUpload(file);
                  e.target.value = "";
                }}
              />
            </div>

            {/* Remove photo link */}
            {user.hasImage && !isUploading && (
              <button
                onClick={() => void handleRemovePhoto()}
                className="mt-2 text-xs text-destructive hover:underline"
              >
                {t("remove_photo")}
              </button>
            )}

            {/* Name + email */}
            {displayName && (
              <p className="mt-3 text-lg font-semibold">{displayName}</p>
            )}
            {primaryEmail && (
              <p className="text-sm text-muted mt-0.5">{primaryEmail}</p>
            )}

            {/* Error message */}
            {errorMessage && (
              <p className="mt-2 text-xs text-destructive text-center">{errorMessage}</p>
            )}
          </div>
        </div>
      </div>

      {/* Email Addresses section */}
      {emails.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted uppercase tracking-wide px-1">{t("email_addresses")}</p>
          <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
            {emails.map((email) => (
              <div key={email.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-7 h-7 rounded-md bg-background flex items-center justify-center flex-shrink-0">
                  <Mail size={14} className="text-primary" />
                </div>
                <span className="text-sm flex-1 truncate">{email.emailAddress}</span>
                {email.id === user.primaryEmailAddressId && (
                  <span className="text-[10px] font-semibold text-success bg-success/12 px-2 py-0.5 rounded-full">
                    {t("primary_email_badge")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connected Accounts section */}
      {uniqueAccounts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted uppercase tracking-wide px-1">{t("connected_accounts")}</p>
          <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
            {uniqueAccounts.map((account) => (
              <div key={account.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-7 h-7 rounded-md bg-background flex items-center justify-center flex-shrink-0">
                  <LinkIcon size={14} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{formatProviderName(account.provider ?? "unknown")}</p>
                  {account.emailAddress && (
                    <p className="text-xs text-muted truncate">{account.emailAddress}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

