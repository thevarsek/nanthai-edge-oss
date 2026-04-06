import { useUser } from "@clerk/clerk-react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

// ─── Component ─────────────────────────────────────────────────────────────

interface AccountSectionProps {
  onShowProfile: () => void;
}

export function AccountSection({ onShowProfile }: AccountSectionProps) {
  const { t } = useTranslation();
  const { user } = useUser();

  if (!user) return null;

  const displayName =
    user.fullName ??
    user.username ??
    user.primaryEmailAddress?.emailAddress ??
    t("account");
  const email = user.primaryEmailAddress?.emailAddress;
  const avatarUrl = user.imageUrl;

  return (
    <div className="rounded-2xl bg-surface-2 overflow-hidden">
      <button
        onClick={onShowProfile}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
      >
        <img
          src={avatarUrl}
          alt={displayName}
          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {email && (
            <p className="text-xs text-muted truncate mt-0.5">{email}</p>
          )}
        </div>
        <ChevronRight size={14} className="text-muted flex-shrink-0" />
      </button>
    </div>
  );
}
