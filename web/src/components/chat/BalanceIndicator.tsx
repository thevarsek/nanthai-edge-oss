// components/chat/BalanceIndicator.tsx — Small right-aligned credit balance text.
// Hidden when balance hasn't been fetched yet. Color-coded green/amber/red.

import { balanceTierOf, formatUsd, type BalanceTier } from "@/hooks/useSharedData";

const tierColorClass: Record<BalanceTier, string> = {
  green: "text-green-400",
  amber: "text-amber-400",
  red: "text-red-400",
  unknown: "text-muted",
};

interface Props {
  balance: number | null;
}

/**
 * Non-interactive credit balance indicator. Renders directly above
 * the MessageInput on the chat page. Shows nothing when balance is null.
 */
export function BalanceIndicator({ balance }: Props) {
  if (balance === null) return null;

  const tier = balanceTierOf(balance);

  return (
    <div className="w-full text-right pr-4 pb-0.5">
      <span className={`text-xs font-medium ${tierColorClass[tier]}`}>
        {formatUsd(balance)}
      </span>
    </div>
  );
}
