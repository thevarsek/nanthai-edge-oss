// ChatDefaultsSection.helpers.tsx
// Shared small components and hooks used by ChatDefaultsSection and its sub-components.

// ─── Section chrome ─────────────────────────────────────────────────────────

export function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium text-muted uppercase tracking-wide px-1 pt-2">
      {children}
    </h3>
  );
}

export function SectionFooter({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted px-1">{children}</p>;
}
