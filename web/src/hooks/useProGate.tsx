import { useState, type ReactNode } from "react";
import { PaywallModal } from "@/components/shared/PaywallModal";
import { useProGate } from "@/hooks/useProGate.hook";

// ─── Gate wrapper ──────────────────────────────────────────────────────────

interface ProGateWrapperProps {
  children: ReactNode;
  /** Optional feature name shown in the upgrade prompt */
  feature?: string;
}

/**
 * Renders `children` when the user is Pro. Otherwise renders an "Upgrade to
 * Pro" button that opens the PaywallModal when clicked.
 */
export function ProGateWrapper({ children, feature }: ProGateWrapperProps) {
  const { isPro } = useProGate();
  const [showPaywall, setShowPaywall] = useState(false);

  if (isPro) return <>{children}</>;

  return (
    <>
      <button
        type="button"
        onClick={() => setShowPaywall(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-white hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={feature ? `Upgrade to Pro to unlock ${feature}` : "Upgrade to Pro"}
      >
        Upgrade to Pro
        {feature && (
          <span className="opacity-75 text-xs">— {feature}</span>
        )}
      </button>

      {showPaywall && (
        <PaywallModal
          feature={feature}
          onClose={() => setShowPaywall(false)}
        />
      )}
    </>
  );
}
