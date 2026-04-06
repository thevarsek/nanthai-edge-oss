// SettingsHelpers.tsx
// iOS-style grouped settings primitives: SettingsSection, NavRow,
// SectionLabel, SettingsRow, ToggleRow, ValueRow, plus action sections.
// Keeps SettingsPage.tsx under 300 lines.

import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { useClerk } from "@clerk/clerk-react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight, UserMinus, LogOut, Loader2,
  Hand, ExternalLink, FileText,
} from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

// ─── SettingsSection ───────────────────────────────────────────────────────
// Mirrors iOS `Section("Header") { rows } footer: { Text(...) }`.
// Wraps children in a rounded card with optional header + footer text.

export function SettingsSection({
  header,
  footer,
  children,
  noPadding,
}: {
  header?: string;
  footer?: string;
  children: ReactNode;
  /** When true, children are NOT wrapped in the rounded card. Useful when
   *  the child already provides its own card (e.g. AccountSection). */
  noPadding?: boolean;
}) {
  return (
    <div className="space-y-2">
      {header && <SectionLabel>{header}</SectionLabel>}
      {noPadding ? (
        children
      ) : (
        <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
          {children}
        </div>
      )}
      {footer && (
        <p className="text-xs text-muted px-1">{footer}</p>
      )}
    </div>
  );
}

// ─── NavRow ────────────────────────────────────────────────────────────────
// A navigation row with icon, label, optional trailing detail, and chevron.

export function NavRow({
  icon,
  label,
  detail,
  href,
  onClick,
}: {
  icon?: ReactNode;
  label: string;
  /** Small trailing text shown before the chevron (e.g. current value). */
  detail?: string;
  href?: string;
  onClick?: () => void;
}) {
  const inner = (
    <div className="flex items-center gap-3 px-4 py-3">
      {icon && <span className="text-primary flex-shrink-0">{icon}</span>}
      <span className="flex-1 text-sm">{label}</span>
      {detail && (
        <span className="text-xs text-muted truncate max-w-[10rem]">{detail}</span>
      )}
      <ChevronRight size={14} className="text-muted flex-shrink-0" />
    </div>
  );

  if (href) {
    return (
      <Link to={href} className="block hover:bg-surface-3 transition-colors">
        {inner}
      </Link>
    );
  }
  return (
    <button onClick={onClick} className="w-full hover:bg-surface-3 transition-colors text-left">
      {inner}
    </button>
  );
}

// ─── SettingsRow ───────────────────────────────────────────────────────────
// Generic settings row with left content and right content.

export function SettingsRow({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 w-full text-left${
        onClick ? " hover:bg-surface-3 transition-colors cursor-pointer" : ""
      }`}
    >
      {children}
    </Comp>
  );
}

// ─── ValueRow ──────────────────────────────────────────────────────────────
// Shows a label on the left and a value on the right (like iOS HStack label+detail).

export function ValueRow({
  icon,
  label,
  value,
  valueColor,
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {icon && <span className="text-primary flex-shrink-0">{icon}</span>}
      <span className="flex-1 text-sm">{label}</span>
      <span className={`text-sm ${valueColor ?? "text-muted"}`}>{value}</span>
    </div>
  );
}

// ─── SectionLabel ──────────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-medium text-muted uppercase tracking-wide px-1">
      {children}
    </h3>
  );
}

// ─── SignOutSection ────────────────────────────────────────────────────────

export function SignOutSection() {
  const { t } = useTranslation();
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);
  const navigate = useNavigate();

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate("/");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="rounded-2xl bg-surface-2 overflow-hidden">
      <button
        onClick={handleSignOut}
        disabled={signingOut}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left disabled:opacity-50"
      >
        <LogOut size={16} className="text-red-400 flex-shrink-0" />
        <span className="flex-1 text-sm text-red-400">
          {signingOut ? t("signing_out") : t("sign_out")}
        </span>
        {signingOut && (
          <Loader2 className="animate-spin w-4 h-4 text-muted flex-shrink-0" />
        )}
      </button>
    </div>
  );
}

// ─── DeleteAccountSection ──────────────────────────────────────────────────

export function DeleteAccountSection() {
  const { t } = useTranslation();
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteAccount = useAction(api.account.actions.deleteAccount);
  const { signOut } = useClerk();
  const navigate = useNavigate();

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteAccount({});
      await signOut();
      navigate("/");
    } finally {
      setDeleting(false);
      setShowConfirm(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="rounded-2xl bg-surface-2 overflow-hidden">
        <button
          onClick={() => setShowConfirm(true)}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
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
      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleDelete}
        title={t("delete_account_confirm_title")}
        description={t("delete_account_description")}
        confirmLabel={deleting ? t("deleting") : t("delete_my_account")}
        confirmVariant="destructive"
      />
    </div>
  );
}

// ─── LegalSection ──────────────────────────────────────────────────────────

export function LegalSection() {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
      <a
        href="https://nanthai.tech/privacy"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors"
      >
        <Hand size={16} className="text-primary flex-shrink-0" />
        <span className="flex-1 text-sm">{t("privacy_policy")}</span>
        <ExternalLink size={12} className="text-muted" />
      </a>
      <a
        href="https://nanthai.tech/terms"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors"
      >
        <FileText size={16} className="text-primary flex-shrink-0" />
        <span className="flex-1 text-sm">{t("terms_of_service")}</span>
        <ExternalLink size={12} className="text-muted" />
      </a>
    </div>
  );
}
