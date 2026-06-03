import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@clerk/react";
import { useAction } from "convex/react";
import { UserMinus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@convex/_generated/api";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

export function DeleteAccountSection() {
  const { t } = useTranslation();
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const deleteAccount = useAction(api.account.actions.deleteAccount);
  const { isLoaded, isSignedIn, user } = useUser();
  const navigate = useNavigate();
  const canDeleteAccount = isLoaded && isSignedIn && user != null;

  const handleDelete = async () => {
    if (deleting) return;
    if (!canDeleteAccount || !user) {
      setErrorMessage(t("you_are_not_signed_in"));
      return;
    }

    setDeleting(true);
    setErrorMessage(null);
    try {
      await deleteAccount({});
      try {
        await user.delete();
      } catch {
        setErrorMessage(
          t("delete_account_identity_cleanup_failed", {
            defaultValue:
              "Account data was deleted, but sign-in cleanup failed. Try deleting the account again or contact support.",
          }),
        );
        return;
      }
      navigate("/");
      setShowConfirm(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("something_went_wrong"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="rounded-2xl bg-surface-2 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          disabled={deleting || !canDeleteAccount}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left disabled:opacity-50"
        >
          <UserMinus size={16} className="text-red-400 flex-shrink-0" />
          <span className="flex-1 text-sm text-red-400">
            {deleting ? t("deleting") : t("delete_account")}
          </span>
        </button>
      </div>
      <p className="text-xs text-muted px-1">
        {t("delete_account_footer")}
      </p>
      {errorMessage && <p className="text-xs text-red-400 px-1">{errorMessage}</p>}
      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => {
          if (!deleting) setShowConfirm(false);
        }}
        onConfirm={handleDelete}
        title={t("delete_account_confirm_title")}
        description={t("delete_account_description")}
        confirmLabel={deleting ? t("deleting") : t("delete_my_account")}
        confirmVariant="destructive"
        errorMessage={errorMessage}
      />
    </div>
  );
}
